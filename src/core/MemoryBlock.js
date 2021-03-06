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

/**
 * Class to encapsulate an ArrayBuffer with utility views to read/write data.
 */
export class MemoryBlock {
    /**
     * Instantiates a memory block in the specified heap, at the memory address and the specified size.
     * Memory blocks can easily be recreated in web workers.
     * @param {Heap} heap - The heap which will contain the memory.
     * @param {number} address - The byte address of the beginning of the memory.
     * @param {number} size - The size, in bytes, of this memory block.
     */
    constructor(heap, address, size) {
        this.mHeap = heap;
        this.mOffset = address;
        this.mSize = size;
        this.mDataView = new DataView(this.mHeap.buffer, this.mOffset, this.mSize);
    }

    /**
     * The byte address of this memory block in its heap.
     * @return {number}
     */
    get address() {
        return this.mOffset;
    }

    /**
     * The heap this memory block belongs to.
     * @return {Heap}
     */
    get heap() {
        return this.mHeap;
    }

    /**
     * The ArrayBuffer this memory is tied to.
     * @return {ArrayBuffer|SharedArrayBuffer}
     */
    get buffer() {
        return this.mHeap.buffer;
    }

    /**
     * The size, in bytes, of this memory block.
     * @return {number}
     */
    get size() {
        return this.mSize;
    }

    /**
     * A DataView instance bound to the memory accessible by this memory block.
     * @return {DataView}
     */
    get dataView() {
        return this.mDataView;
    }

    /**
     * Frees this memory block, this function just calls `free` on the heap.
     */
    free() {
        this.mHeap.free(this);
    }

    /**
     * Makes sure this memory block is not usable anymore. Automatically called by the heap when this memory block is freed.
     * @private
     */
    _destroy() {
        this.mHeap = null;
        this.mOffset = -1;
        this.mSize = 0;
        this.mDataView = null;
    }
}
