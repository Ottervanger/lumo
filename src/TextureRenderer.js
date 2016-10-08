(function() {

    'use strict';

    const esper = require('esper');
    const Renderer = require('./Renderer');

    const shader = {
        vert:
            `
            precision highp float;
            attribute vec2 aPosition;
            attribute vec2 aTextureCoord;
            uniform vec4 uTextureCoordOffset;
            uniform vec2 uTileOffset;
            uniform float uTileScale;
            uniform mat4 uProjectionMatrix;
            varying vec2 vTextureCoord;
            void main() {
                vTextureCoord = vec2(
                    uTextureCoordOffset.x + (aTextureCoord.x * uTextureCoordOffset.z),
                    uTextureCoordOffset.y + (aTextureCoord.y * uTextureCoordOffset.w));
                vec2 wPosition = (aPosition * uTileScale) + uTileOffset;
                gl_Position = uProjectionMatrix * vec4(wPosition, 0.0, 1.0);
            }
            `,
        frag:
            `
            precision highp float;
            uniform sampler2D uTextureSampler;
            varying vec2 vTextureCoord;
            void main() {
                gl_FragColor = texture2D(uTextureSampler, vTextureCoord);
            }
            `
    };

    const createQuad = function(min, max) {
        const BYTES_PER_FLOAT = 4;
        const NUM_VERTICES = 6;
        const COMPONENTS_PER_VERTEX = 2;
        const BYTE_LENGTH = COMPONENTS_PER_VERTEX * NUM_VERTICES * BYTES_PER_FLOAT;
        const vertices = new Float32Array(24);
        // positions
        vertices[0] = min;      vertices[1] = min;
        vertices[2] = max;      vertices[3] = min;
        vertices[4] = max;      vertices[5] = max;
        vertices[6] = min;      vertices[7] = min;
        vertices[8] = max;      vertices[9] = max;
        vertices[10] = min;     vertices[11] = max;
        // uvs
        vertices[12] = 0;       vertices[13] = 0;
        vertices[14] = 1;       vertices[15] = 0;
        vertices[16] = 1;       vertices[17] = 1;
        vertices[18] = 0;       vertices[19] = 0;
        vertices[20] = 1;       vertices[21] = 1;
        vertices[22] = 0;       vertices[23] = 1;
        // create quad buffer
        return new esper.VertexBuffer(
            vertices,
            {
                0: {
                    size: COMPONENTS_PER_VERTEX,
                    type: 'FLOAT',
                    byteOffset: 0
                },
                1: {
                    size: COMPONENTS_PER_VERTEX,
                    type: 'FLOAT',
                    byteOffset: BYTE_LENGTH
                }
            },
            {
                count: NUM_VERTICES,
            });
    };

    const getRenderables = function(plot, pyramid) {

        // get all currently visible tile coords
        const coords = plot.viewport.getVisibleCoords(
            plot.tileSize,
            plot.zoom,
            Math.round(plot.zoom), // get tiles closest to current zoom
            plot.wraparound);

        const renderables = [];
        coords.forEach(coord => {
            // check if we have any tile LOD available
            const lod = pyramid.getAvailableLOD(coord);
            if (lod) {
                const renderable = {
                    coord: coord,
                    tile: lod.tile,
                    scale: Math.pow(2, plot.zoom - coord.z),
                    offset: [
                        lod.offset.x,
                        lod.offset.y,
                        lod.offset.extent,
                        lod.offset.extent
                    ]
                };
                renderables.push(renderable);
            }
        });

        return renderables;
    };

    const renderTiles = function(gl, shader, quad, plot, pyramid) {
        // update projection
        const proj = plot.viewport.getOrthoMatrix();

        // bind shader
        shader.use();
        // set uniforms
        shader.setUniform('uProjectionMatrix', proj);
        // set texture sampler unit
        shader.setUniform('uTextureSampler', 0);

        // bind quad
        quad.bind();

        // get the renderables
        const renderables = getRenderables(plot, pyramid);

        // for each renderable
        renderables.forEach(renderable => {
            const tile = renderable.tile;
            const coord = renderable.coord;
            // bind texture
            tile.data.bind(0);
            // set tile opacity
            shader.setUniform('uTextureCoordOffset', renderable.offset);
            // set tile scale
            shader.setUniform('uTileScale', renderable.scale);
            // get tile offset
            const tileOffset = [
                coord.x * renderable.scale * plot.tileSize,
                coord.y * renderable.scale * plot.tileSize
            ];
            // get view offset
            const viewOffset = [
                plot.viewport.x,
                plot.viewport.y
            ];
            const offset = [
                tileOffset[0] - viewOffset[0],
                tileOffset[1] - viewOffset[1]
            ];
            shader.setUniform('uTileOffset', offset);
            // draw
            quad.draw();
            // no need to unbind texture
        });

        // unbind quad
        quad.unbind();
    };

    /**
     * Class representing a renderer.
     */
    class ScreenRenderer extends Renderer {

        /**
         * Instantiates a new ScreenRenderer object.
         */
        constructor() {
            super();
            this.quad = null;
            this.shader = null;
        }

        /**
         * Executed when the renderer is attached to a layer.
         *
         * @param {Layer} layer - The layer to attach the renderer to.
         *
         * @returns {Renderer} The renderer object, for chaining.
         */
        onAdd(layer) {
            super.onAdd(layer);
            this.quad = createQuad(0, layer.plot.tileSize);
            this.shader = new esper.Shader(shader);
            return this;
        }

        /**
         * Executed when the renderer is removed from a layer.
         *
         * @param {Layer} layer - The layer to remove the renderer from.
         *
         * @returns {Renderer} The renderer object, for chaining.
         */
        onRemove(layer) {
            super.onRemove(layer);
            this.quad = null;
            this.shader = null;
            return this;
        }

        /**
         * The draw function that is executed per frame.
         *
         * @param {Number} timestamp - The frame timestamp.
         *
         * @returns {Renderer} The renderer object, for chaining.
         */
        draw() {
            // render the tiles to the framebuffer
            renderTiles(
                this.gl,
                this.shader,
                this.quad,
                this.layer.plot,
                this.layer.pyramid);
            return this;
        }
    }

    module.exports = ScreenRenderer;

}());
