'use strict';

const defaultTo = require('lodash/defaultTo');
const VertexBuffer = require('../../../../webgl/vertex/VertexBuffer');
const WebGLVertexTileRenderer = require('../WebGLVertexTileRenderer');

// Constants

/**
 * Numver of vertices supported per chunk.
 * @private
 * @constant {number}
 */
const CHUNK_SIZE = 128 * 128;

/**
 * Inner radius of star.
 * @private
 * @constant {number}
 */
const STAR_INNER_RADIUS = 0.4;

/**
 * Outer radius of star.
 * @private
 * @constant {number}
 */
const STAR_OUTER_RADIUS = 1.0;

/**
 * number of points on the star.
 * @private
 * @constant {number}
 */
const STAR_NUM_POINTS = 5;

/**
 * Shader GLSL source.
 * @private
 * @constant {Object}
 */
const SHADER_GLSL = {
	vert:
		`
		precision highp float;
		attribute vec2 aPosition;
		attribute vec2 aOffset;
		attribute float aRadius;
		uniform vec2 uTileOffset;
		uniform float uScale;
		uniform mat4 uProjectionMatrix;
		void main() {
			vec2 wPosition = (aPosition * aRadius) + (aOffset * uScale) + uTileOffset;
			gl_Position = uProjectionMatrix * vec4(wPosition, 0.0, 1.0);
		}
		`,
	frag:
		`
		precision highp float;
		uniform vec4 uColor;
		void main() {
			gl_FragColor = uColor;
		}
		`
};

// Private Methods

const createStar = function(gl) {
	const theta = (2 * Math.PI) / STAR_NUM_POINTS;
	const htheta = theta / 2.0;
	const qtheta = theta / 4.0;
	const positions = new Float32Array((STAR_NUM_POINTS * 2) * 2 + 4);
	positions[0] = 0;
	positions[1] = 0;
	for (let i=0; i<STAR_NUM_POINTS; i++) {
		const angle = i * theta;
		let sx = Math.cos(angle - qtheta) * STAR_INNER_RADIUS;
		let sy = Math.sin(angle - qtheta) * STAR_INNER_RADIUS;
		positions[i*4+2] = sx;
		positions[i*4+1+2] = sy;
		sx = Math.cos(angle + htheta - qtheta) * STAR_OUTER_RADIUS;
		sy = Math.sin(angle + htheta - qtheta) * STAR_OUTER_RADIUS;
		positions[i*4+2+2] = sx;
		positions[i*4+3+2] = sy;
	}
	positions[positions.length-2] = positions[2];
	positions[positions.length-1] = positions[3];
	return new VertexBuffer(
		gl,
		positions,
		{
			0: {
				size: 2,
				type: 'FLOAT'
			}
		},
		{
			mode: 'TRIANGLE_FAN',
			count: positions.length / 2
		});
};

/**
 * Class representing a webgl instanced shape tile renderer.
 */
class WebGLShapeTileRenderer extends WebGLVertexTileRenderer {

	/**
	 * Instantiates a new WebGLShapeTileRenderer object.
	 *
	 * @param {Object} options - The options object.
	 * @param {Array} options.color - The color of the points.
	 */
	constructor(options = {}) {
		super();
		this.color = defaultTo(options.color, [ 1.0, 0.4, 0.1, 0.8 ]);
		this.shape = null;
		this.shader = null;
		this.atlas = null;
	}

	/**
	 * Executed when the layer is attached to a plot.
	 *
	 * @param {Layer} layer - The layer to attach the renderer to.
	 *
	 * @returns {Renderer} The renderer object, for chaining.
	 */
	onAdd(layer) {
		super.onAdd(layer);
		this.shape = createStar(this.gl);
		this.shader = this.createShader(SHADER_GLSL);
		this.atlas = this.createVertexAtlas({
			chunkSize: CHUNK_SIZE,
			attributePointers: {
				// offset
				1: {
					size: 2,
					type: 'FLOAT'
				},
				// radius
				2: {
					size: 1,
					type: 'FLOAT'
				}
			}
		});
		return this;
	}

	/**
	 * Executed when the layer is removed from a plot.
	 *
	 * @param {Layer} layer - The layer to remove the renderer from.
	 *
	 * @returns {Renderer} The renderer object, for chaining.
	 */
	onRemove(layer) {
		this.destroyVertexAtlas(this.atlas);
		this.atlas = null;
		this.shape = null;
		this.shader = null;
		super.onRemove(layer);
		return this;
	}

	/**
	 * The draw function that is executed per frame.
	 *
	 * @returns {Renderer} The renderer object, for chaining.
	 */
	draw() {
		const gl = this.gl;
		const shader = this.shader;
		const atlas = this.atlas;
		const shape = this.shape;
		const plot = this.layer.plot;
		const renderables = this.getRenderables();
		const proj = this.getOrthoMatrix();

		// bind render target
		plot.renderBuffer.bind();
		// clear render target
		plot.renderBuffer.clear();

		// set blending func
		gl.enable(gl.BLEND);
		gl.blendFunc(gl.SRC_ALPHA, gl.ONE);

		// bind shader
		shader.use();

		// set global uniforms
		shader.setUniform('uProjectionMatrix', proj);
		shader.setUniform('uColor', this.color);

		// bind shape
		shape.bind();

		// binds the buffer to instance
		atlas.bindInstanced();

		// for each renderable
		for (let i=0; i<renderables.length; i++) {
			const renderable = renderables[i];
			// set tile uniforms
			shader.setUniform('uScale', renderable.scale);
			shader.setUniform('uTileOffset', renderable.tileOffset);
			// draw the instances
			atlas.drawInstanced(renderable.hash, shape.mode, shape.count);
		}

		// unbind
		atlas.unbindInstanced();

		// unbind quad
		shape.unbind();

		// unbind render target
		plot.renderBuffer.unbind();

		// render framebuffer to the backbuffer
		plot.renderBuffer.blitToScreen(this.layer.opacity);

		return this;
	}
}

module.exports = WebGLShapeTileRenderer;
