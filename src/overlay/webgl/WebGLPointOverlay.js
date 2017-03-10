'use strict';

const defaultTo = require('lodash/defaultTo');
const VertexBuffer = require('../../render/webgl/vertex/VertexBuffer');
const WebGLOverlay = require('./WebGLOverlay');

// Constants

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
		uniform vec2 uViewOffset;
		uniform float uPointRadius;
		uniform float uExtent;
		uniform float uPixelRatio;
		uniform mat4 uProjectionMatrix;
		void main() {
			vec2 wPosition = (aPosition * uExtent) + uViewOffset;
			gl_PointSize = uPointRadius * 2.0 * uPixelRatio;
			gl_Position = uProjectionMatrix * vec4(wPosition, 0.0, 1.0);
		}
		`,
	frag:
		`
		#ifdef GL_OES_standard_derivatives
			#extension GL_OES_standard_derivatives : enable
		#endif
		precision highp float;
		uniform vec4 uPointColor;
		void main() {
			vec2 cxy = 2.0 * gl_PointCoord - 1.0;
			float radius = dot(cxy, cxy);
			float alpha = 1.0;
			#ifdef GL_OES_standard_derivatives
				float delta = fwidth(radius);
				alpha = 1.0 - smoothstep(1.0 - delta, 1.0 + delta, radius);
			#else
				if (radius > 1.0) {
					discard;
				}
			#endif
			gl_FragColor = vec4(uPointColor.rgb, uPointColor.a * alpha);
		}
		`
};

const bufferPoints = function(points) {
	const buffer = new Float32Array(points.length * 2);
	for (let i=0; i<points.length; i++) {
		const point = points[i];
		buffer[i*2] = point[0];
		buffer[i*2+1] = point[1];
	}
	return buffer;
};

const createVertexBuffer = function(gl, points) {
	const data = bufferPoints(points);
	return new VertexBuffer(
		gl,
		data,
		{
			0: {
				size: 2,
				type: 'FLOAT'
			}
		},
		{
			mode: 'POINTS',
			count: points.length
		});
};

/**
 * Class representing an overlay.
 */
class WebGLPointOverlay extends WebGLOverlay {

	/**
	 * Instantiates a new WebGLPointOverlay object.
	 */
	constructor(options = {}) {
		super(options);
		this.pointColor = defaultTo(options.pointColor, [ 1.0, 0.0, 1.0, 1.0 ]);
		this.pointRadius = defaultTo(options.pointRadius, 4);
		this.points = new Map();
		this.buffers = new Map();
		this.ext = null;
	}

	/**
	 * Executed when the overlay is attached to a plot.
	 *
	 * @param {Plot} plot - The plot to attach the overlay to.
	 *
	 * @returns {WebGLPointOverlay} The overlay object, for chaining.
	 */
	onAdd(plot) {
		super.onAdd(plot);
		this.ext = this.gl.getExtension('OES_standard_derivatives');
		this.shader = this.createShader(SHADER_GLSL);
		this.buffers = new Map();
		if (this.points.size > 0) {
			this.points.forEach((points, id) => {
				const buffer = createVertexBuffer(this.gl, points);
				this.buffers.set(id, buffer);
			});
		}
		return this;
	}

	/**
	 * Executed when the overlay is removed from a plot.
	 *
	 * @param {Plot} plot - The plot to remove the overlay from.
	 *
	 * @returns {WebGLPointOverlay} The overlay object, for chaining.
	 */
	onRemove(plot) {
		super.onAdd(plot);
		this.shader = null;
		this.buffers = new Map();
		this.ext = null;
		return this;
	}

	/**
	 * Add a set of points to render.
	 *
	 * @param {String} id - The id to store the points under.
	 * @param {Array} points - The points.
	 *
	 * @returns {WebGLPointOverlay} The overlay object, for chaining.
	 */
	addPoints(id, points) {
		this.points.set(id, points);
		if (this.plot) {
			const buffer = createVertexBuffer(this.gl, points);
			this.buffers.push(buffer);
		}
		return this;
	}

	/**
	 * Remove a set of points by id from the overlay.
	 *
	 * @param {String} id - The id to store the points under.
	 *
	 * @returns {WebGLPointOverlay} The overlay object, for chaining.
	 */
	removePoints(id) {
		this.points.delete(id);
		if (this.plot) {
			this.buffers.delete(id);
		}
		return this;
	}

	/**
	 * Remove all points from the layer.
	 *
	 */
	clearPolylines() {
		this.points = new Map();
		this.buffers = new Map();
	}

	/**
	 * The draw function that is executed per frame.
	 *
	 * @param {Number} timestamp - The frame timestamp.
	 *
	 * @returns {WebGLPointOverlay} The overlay object, for chaining.
	 */
	draw() {
		const gl = this.gl;
		const shader = this.shader;
		const buffers = this.buffers;
		const plot = this.plot;
		const proj = this.getOrthoMatrix();
		const extent = Math.pow(2, plot.zoom) * plot.tileSize;
		const offset = [ -plot.viewport.x, -plot.viewport.y ];

		// set blending func
		gl.enable(gl.BLEND);
		gl.blendFunc(gl.SRC_ALPHA, gl.ONE);

		// bind shader
		shader.use();

		// set global uniforms
		shader.setUniform('uProjectionMatrix', proj);
		shader.setUniform('uViewOffset', offset);
		shader.setUniform('uExtent', extent);
		shader.setUniform('uPointColor', this.pointColor);
		shader.setUniform('uPointRadius', this.pointRadius);
		shader.setUniform('uPixelRatio', plot.pixelRatio);

		// for each point buffer
		buffers.forEach(buffer => {
			// draw the points
			buffer.bind();
			buffer.draw();
		});

		return this;
	}
}

module.exports = WebGLPointOverlay;
