/*
 * Copyright (c) 2019 Uncharted Software Inc.
 * http://www.uncharted.software/
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of
 * this software and associated documentation files (the "Software"), to deal in
 * the Software without restriction, including without limitation the rights to
 * use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
 * of the Software, and to permit persons to whom the Software is furnished to do
 * so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
import {Heap} from '../../core/Heap';
import {MemoryBlock} from '../../core/MemoryBlock';
import {Table} from '../Table';
import {ByteString} from '../ByteString';
import * as Types from '../../core/Types';

/**
 * Class to process filters on Tables.
 * This class is meant to be used by filter workers, but it is safe to use on the main thread as well.
 */
export class FilterProcessor {
    /**
     * Creates a new instance and reconstructs the Heap, Memory Object and Table specified in the config object.
     * NOTE: Heap, MemoryBlock and Table classes are thread safe.
     * @param {{
     * heapBuffer: ArrayBufferLike,
     * tableAddress: number,
     * tableSize: number
     * }} config - Configuration object.
     */
    constructor(config) {
        this.mHeap = new Heap(config.heapBuffer);
        this.mTableMemory = new MemoryBlock(this.mHeap, config.tableAddress, config.tableSize);
        this.mTable = new Table(this.mTableMemory);
        this.mRow = this.mTable.getRow();
    }

    /**
     * Processes the rules in batches the size configures in the config object
     * @param {{
     * rules: Array,
     * indicesAddress: number,
     * rowBatchSize: number,
     * resultAddress: number,
     * resultSize: number,
     * resultDescription: Array
     * }} config - Configuration object.
     */
    process(config) {
        const indices = new Uint32Array(this.mHeap.buffer, config.indicesAddress, 2);
        const batchSize = config.rowBatchSize;
        const resultMemory = new MemoryBlock(this.mHeap, config.resultAddress, config.resultSize);
        const resultView = resultMemory.dataView;
        const rowCount = this.mTable.rowCount;
        const row = this.mRow;
        const filterTester = this._generateFilterTester(config.rules, row);
        const resultWriter = this._generateResultWriter(config.resultDescription, indices, row);
        let i;
        let n;
        let r;
        for (i = Atomics.add(indices, 0, batchSize); i < rowCount; i = Atomics.add(indices, 0, batchSize)) {
            n = Math.min(i + batchSize, rowCount);
            for (r = i; r < n; ++r) {
                row.index = r;
                if (filterTester()) {
                    resultWriter(row, resultView);
                }
            }
        }
    }

    /**
     * Generates a function that writes the row values, as specified in the `description` array, to the specified data view.
     * NOTE: The same Row instance that will be used to iterate through the table must be passed to this method, Row
     * instances are simply pointers to a position in the table that are shifted as they change row. This function takes
     * advantage of such behaviour to improve performance.
     * @param {Array} description - Result description object.
     * @param {Uint32Array} indices - The indices array to count processed rows and results. Must be backed by a SharedArrayBuffer
     * @param {Row} baseRow - The base row that will be used to iterate through the table.
     * @return {function(row:Row, view:DataView):void}
     * @private
     */
    _generateResultWriter(description, indices, baseRow) {
        const writers = [];
        let resultSize = 0;
        for (let i = 0; i < description.length; ++i) {
            const type = Types.typeByName(description[i].type);
            const fieldOffset = resultSize;
            if (description[i].column) {
                const getter = baseRow.accessors[description[i].column].getter;
                writers.push(function resultWriterField(row, offset, view) {
                    type.set(view, getter(), offset + fieldOffset);
                });
            } else {
                writers.push(function resultWriterRowIndex(row, offset, view) {
                    type.set(view, row.index, offset + fieldOffset);
                });
            }
            resultSize += description[i].size;
        }

        const writersLength = writers.length;
        let offset;
        let i;
        return function resultWriter(row, view) {
            offset = Atomics.add(indices, 1, 1) * resultSize;
            for (i = 0; i < writersLength; ++i) {
                writers[i](row, offset, view);
            }
        };
    }

    /**
     * Generates a function that tests the specified rule sets against the specified row.
     * NOTE: The same Row instance that will be used to iterate through the table must be passed to this method.
     * @param {Array} rules - An array of rule sets to test against.
     * @param {Row} row - The row instance that will be used to iterate through the table.
     * @return {function():boolean}
     * @private
     */
    _generateFilterTester(rules, row) {
        if (!rules || !rules.length) {
            return function filterTesterEmpty() {
                return true;
            };
        }

        const testers = [];
        const testersLength = rules.length;
        for (let i = 0; i < testersLength; ++i) {
            testers.push(this._generateRuleTester(rules[i], row));
        }

        return function filterTester() {
            for (let i = 0; i < testersLength; ++i) {
                if (testers[i]()) {
                    return true;
                }
            }
            return false;
        };
    }

    /**
     * Generates a function that tests the specified rule set against the specified row.
     * NOTE: The same Row instance that will be used to iterate through the table must be passed to this method.
     * @param {Array} rule - The rule set to test.
     * @param {Row} row - The row instance that will be used to iterate through the table.
     * @return {function():boolean}
     * @private
     */
    _generateRuleTester(rule, row) {
        const testers = [];
        const testersLength = rule.length;
        for (let i = 0; i < testersLength; ++i) {
            testers.push(this._generateFieldTester(rule[i], row));
        }

        return function ruleTester() {
            for (let i = 0; i < testersLength; ++i) {
                if (!testers[i]()) {
                    return false;
                }
            }
            return true;
        };
    }

    /**
     * Generate a function that tests the specified field in the specified row.
     * NOTE: The same Row instance that will be used to iterate through the table must be passed to this method.
     * @param {Object} field - Object containing the field and parameters to test.
     * @param {Row} row - The row instance that will be used to iterate through the table.
     * @return {function():boolean|null}
     * @private
     */
    _generateFieldTester(field, row) {
        const column = this.mTable.header.columns[field.name];
        const getter = row.accessors[field.name].getter;
        switch (field.operation) {
            case 'contains': {
                const value = ByteString.fromString(field.value);
                return function filterContains() { return getter().containsCase(value); };
            }

            case 'equal': {
                if (column.type === 'string' || column.type === 'date') {
                    const value = ByteString.fromString(field.value);
                    return function filterEquals() {
                        return getter().equalsCase(value);
                    };
                }
                const value = parseFloat(field.value);
                return function filterEquals() {
                    return getter() === value;
                };
            }

            case 'notEqual': {
                if (column.type === 'string' || column.type === 'date') {
                    const value = ByteString.fromString(field.value);
                    return function filterEquals() {
                        return !getter().equalsCase(value);
                    };
                }
                const value = parseFloat(field.value);
                return function filterNotEqual() {
                    return getter() !== value;
                };
            }

            case 'moreThan': {
                const value = parseFloat(field.value);
                return function filterMoreThan() {
                    return getter() > value;
                };
            }

            case 'lessThan': {
                const value = parseFloat(field.value);
                return function filterLessThan() {
                    return getter() < value;
                };
            }

            default:
                break;
        }
        return null;
    }
}
