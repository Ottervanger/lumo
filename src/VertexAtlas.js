(function() {

    'use strict';

    const esper = require('esper');
    const defaultTo = require('lodash/defaultTo');
    const forIn = require('lodash/forIn');

    const BYTES_PER_TYPE = {
        BYTE: 1,
        UNSIGNED_BYTE: 1,
        SHORT: 2,
        UNSIGNED_SHORT: 2,
        FIXED: 4,
        FLOAT: 4
    };

    const calcChunkByteSize = function(pointers, chunkSize) {
        let byteSize = 0;
        pointers.forEach(pointer => {
            byteSize += BYTES_PER_TYPE[pointer.type] * pointer.size * chunkSize;
        });
        return byteSize;
    };

    const calcByteOffsets = function(chunk, pointers, chunkByteOffset) {
        let byteOffset = 0;
        pointers.forEach((pointer, location) => {
            chunk.byteOffsets[location] = chunkByteOffset + byteOffset;
            byteOffset += BYTES_PER_TYPE[pointer.type] * pointer.size;
        });
        chunk.byteStride = byteOffset;
    };

    /**
     * Class representing a vertex atlas.
     */
    class VertexAtlas {

        /**
         * Instantiates a new VertexAtlas object.
         * NOTE: assumes interleaved vertex format.
         *
         * @param {Number} tileSize - The size of a tile, in pixels.
         * @param {Object} options - The parameters of the animation.
         * @param {Number} options.chunkSize - The size of a single chunk, in vertices.
         * @param {Number} options.numChunks - The size of the atlas, in tiles.
         */
        constructor(pointers, options = {}) {
            // get context
            const gl = this.gl = esper.WebGLContext.get();
            // get the extension for hardware instancing
            this.ext = esper.WebGLContext.getExtension('ANGLE_instanced_arrays');
            if (!this.ext) {
                throw 'ANGLE_instanced_arrays WebGL extension is not supported';
            }
            this.numChunks = defaultTo(options.numChunks, 256);
            this.chunkSize = defaultTo(options.chunkSize, 128 * 128);
            // set the pointers of the atlas
            this.pointers = new Map();
            forIn(pointers, (pointer, index) => {
                this.pointers.set(index, pointer);
            });
            // create available chunks
            this.available = new Array(this.numChunks);
            // calc the chunk byte size
            const chunkByteSize = calcChunkByteSize(
                this.pointers,
                this.chunkSize);
            // for each chunk
            for (let i=0; i<this.numChunks; i++) {
                const chunkByteOffset = i * chunkByteSize;
                const available = {
                    count: 0,
                    chunkByteOffset: chunkByteOffset,
                    byteOffsets: {},
                    byteStride: 0
                };
                // calculate interleaved offsets / stride, this only needs
                // to be done once
                calcByteOffsets(
                    available,
                    this.pointers,
                    chunkByteOffset);
                // add chunk
                this.available[i] = available;
            }
            this.used = new Map();
            // create buffer
            this.buffer = gl.createBuffer();
            // calc total size of the buffer
            const byteSize = chunkByteSize * this.numChunks;
            // buffer the data
            gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
            gl.bufferData(gl.ARRAY_BUFFER, byteSize, gl.DYNAMIC_DRAW);
        }

        /**
         * Test whether or not a key is held in the atlas.
         *
         * @param {String} key - The key to test.
         *
         * @returns {boolean} Whether or not the coord exists in the pyramid.
         */
        has(key) {
            return this.used.has(key);
        }

        /**
         * Returns the chunk matching the provided key. If the chunk does not
         * exist, returns undefined.
         *
         * @param {String} key - The key of the chunk to return.
         *
         * @returns {Object} The chunk object.
         */
        get(key) {
            return this.used.get(key);
        }

        /**
         * Set the vertex data for the provided key.
         *
         * @param {String} key - The key of the vertex data.
         * @param {Number} count - The count of vertices added.
         * @param {ArrayBuffer} data - The vertex data.
         */
        set(key, data, count) {
            if (this.has(key)) {
                throw `Tile of coord ${key} already exists in the atlas`;
            }
            if (this.available.length === 0) {
                throw 'No available vertex chunks in atlas';
            }
            // get an available chunk
            const chunk = this.available.pop();
            // update chunk count
            chunk.count = count;
            // buffer the data
            const gl = this.gl;
            gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
            gl.bufferSubData(gl.ARRAY_BUFFER, chunk.chunkByteOffset, data);
            // add to used
            this.used.set(key, chunk);
        }

        /**
         * Flags the chunk matching the provided key as unused in the atlas.
         *
         * @param {String} key - The key of the chunk to free.
         *
         * @returns {VertexAtlas} The VertexAtlas object, for chaining.
         */
        delete(key) {
            if (!this.has(key)) {
                throw `Tile of coord ${key} does not exist in the atlas`;
            }
            // get chunk
            const chunk = this.used.get(key);
            // remove from used
            this.used.delete(key);
            // add to available
            this.available.push(chunk);
            return this;
        }

        /**
         * Binds the vertex atlas and activates the attribute arrays for
         * instancing.
         *
         * @param {String} key - The texture unit to activate. Optional.
         *
         * @returns {VertexAtlas} The TextureAtlas object, for chaining.
         */
        bind() {
            const gl = this.gl;
            const ext = this.ext;
            gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
            // for each attribute pointer
            this.pointers.forEach((pointer, index) => {
                // enable attribute index
                gl.enableVertexAttribArray(index);
                // enable instancing this attribute
                ext.vertexAttribDivisorANGLE(index, 1);
            });
            return this;
        }

        /**
         * Unbinds the vertex atlas and disables the vertex arrays.
         *
         * @returns {TextureAtlas} The TextureAtlas object, for chaining.
         */
        unbind() {
            const gl = this.gl;
            const ext = this.ext;
            // for each attribute pointer
            this.pointers.forEach((pointer, index) => {
                if (index !== 0) {
                    // disable attribute index
                    gl.disableVertexAttribArray(index);
                }
                // disable instancing this attribute
                ext.vertexAttribDivisorANGLE(index, 0);
            });
            return this;
        }

        draw(key, mode, count) {
            if (!this.has(key)) {
                throw `Tile of coord ${key} does not exist in the atlas`;
            }
            const gl = this.gl;
            const ext = this.ext;
            const chunk = this.used.get(key);
            // for each attribute pointer
            this.pointers.forEach((pointer, index) => {
                // set attribute pointer
                gl.vertexAttribPointer(
                    index,
                    pointer.size,
                    gl[pointer.type],
                    false,
                    chunk.byteStride,
                    chunk.byteOffsets[index]);
            });
            // draw the bound vertex array
            ext.drawArraysInstancedANGLE(gl[mode], 0, count, chunk.count);
        }
    }

    module.exports = VertexAtlas;

}());
