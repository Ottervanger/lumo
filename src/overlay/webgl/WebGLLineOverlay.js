'use strict';

//const polylineNormals = require('polyline-normals');
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
		//attribute vec2 aNormal;
		uniform vec2 uViewOffset;
		//uniform float uLineWidth;
		uniform float uExtent;
		//uniform float uPixelRatio;
		uniform mat4 uProjectionMatrix;
		void main() {
			vec2 wPosition = (aPosition * uExtent) + uViewOffset;
			gl_Position = uProjectionMatrix * vec4(wPosition, 0.0, 1.0);
		}
		`,
	frag:
		`
		precision highp float;
		uniform vec4 uLineColor;
		void main() {
			gl_FragColor = vec4(uLineColor.rgb, uLineColor.a);
		}
		`
};

// http://labs.hyperandroid.com/efficient-webgl-stroking

const EPSILON = 0.000001;

const scalarMult = function(a, s) {
	return [
		a[0] * s,
		a[1] * s
	];
};

const perpendicular = function(a) {
	return [
		-a[1],
		a[0]
	];
};

const invert = function(a) {
	return [
		-a[0],
		-a[1]
	];
};

const length = function(a) {
	return Math.sqrt(a[0] * a[0] + a[1] * a[1]);
};

const normalize = function(a) {
	const mod = Math.sqrt(a[0] * a[0] + a[1] * a[1]);
	return [
		a[0] / mod,
		a[1] / mod
	];
};

const add = function(p0, p1) {
	return [
		p0[0] + p1[0],
		p0[1] + p1[1]
	];
};

const sub = function(p0, p1) {
	return [
		p0[0] - p1[0],
		p0[1] - p1[1]
	];
};

const middle = function(p0, p1) {
	return scalarMult(add(p0, p1), 0.5);
};

const equal = function(p0, p1) {
	return p0[0] === p1[0] && p0[1] === p1[1];
};

const signedArea = function(p0, p1, p2) {
	return (p1[0] - p0[0]) * (p2[1] - p0[1]) - (p2[0] - p0[0]) * (p1[1] - p0[1]);
};

const getStrokeGeometry = function(points, strokeWidth = 0.01) {
	if (points.length < 2) {
		return;
	}

	const lineWidth = strokeWidth / 2;
	const vertices = [];
	const middlePoints = [];  // middle points per each line segment.
	let closed = false;

	if (points.length === 2) {
		createTriangles(
			points[0],
			middle(points[0], points[1]),
			points[1],
			vertices,
			lineWidth);
	} else {

		if (equal(points[0], points[points.length - 1])) {
			const p0 = middle(points.shift(), points[0]);
			points.unshift(p0);
			points.push(p0);
			closed = true;
		}

		for (let i=0; i<points.length-1; i++) {
			if (i === 0) {
				middlePoints.push(points[0]);
			} else if (i === points.length - 2) {
				middlePoints.push(points[points.length - 1]);
			} else {
				middlePoints.push(middle(points[i], points[i + 1]));
			}
		}

		for (let i=1; i<middlePoints.length; i++) {
			createTriangles(
				middlePoints[i - 1],
				points[i],
				middlePoints[i],
				vertices,
				lineWidth);
		}
	}

	if (!closed) {
		const p00 = vertices[0];
		const p01 = vertices[1];
		const p02 = points[1];
		const p10 = vertices[vertices.length - 1];
		const p11 = vertices[vertices.length - 3];
		const p12 = points[points.length - 2];
		createRoundCap(points[0], p00, p01, p02, vertices, lineWidth);
		createRoundCap(points[points.length - 1], p10, p11, p12, vertices, lineWidth);
	}

	return vertices;
};

const createRoundCap = function(center, _p0, _p1, nextPointInLine, verts, lineWidth) {

	let angle0 = Math.atan2((_p1[1] - center[1]), (_p1[0] - center[0]));
	let angle1 = Math.atan2((_p0[1] - center[1]), (_p0[0] - center[0]));

	const orgAngle0 = angle0;

	if (angle1 > angle0) {
		if (angle1 - angle0 >= Math.PI - EPSILON) {
			angle1 = angle1 - (2 * Math.PI);
		}
	} else {
		if (angle0 - angle1 >= Math.PI - EPSILON) {
			angle0 = angle0 - (2 * Math.PI);
		}
	}

	let angleDiff = angle1 - angle0;

	if (Math.abs(angleDiff) >= (Math.PI - EPSILON) &&
		Math.abs(angleDiff) <= (Math.PI + EPSILON)) {
		const r1 = sub(center, nextPointInLine);
		if (r1[0] === 0) {
			if (r1[1] > 0) {
				angleDiff = -angleDiff;
			}
		} else if (r1[0] >= -EPSILON) {
			angleDiff = -angleDiff;
		}
	}

	const segmentsPerSemi = 8;
	const nsegments = Math.ceil(Math.abs(angleDiff / Math.PI) * segmentsPerSemi);

	const angleInc = angleDiff / nsegments;

	for (let i=0; i<nsegments; i++) {
		verts.push([ center[0], center[1] ]);
		verts.push([
			center[0] + lineWidth * Math.cos(orgAngle0 + angleInc * i),
			center[1] + lineWidth * Math.sin(orgAngle0 + angleInc * i)
		]);
		verts.push([
			center[0] + lineWidth * Math.cos(orgAngle0 + angleInc * (1 + i)),
			center[1] + lineWidth * Math.sin(orgAngle0 + angleInc * (1 + i))
		]);
	}
};

function lineIntersection(p0, p1, p2, p3) {

	const a0 = p1[1] - p0[1];
	const b0 = p0[0] - p1[0];

	const a1 = p3[1] - p2[1];
	const b1 = p2[0] - p3[0];

	const det = a0 * b1 - a1 * b0;
	if (det > -EPSILON && det < EPSILON) {
		return null;
	}
	const c0 = a0 * p0[0] + b0 * p0[1];
	const c1 = a1 * p2[0] + b1 * p2[1];

	const x = (b1 * c0 - b0 * c1) / det;
	const y = (a0 * c1 - a1 * c0) / det;
	return [ x, y ];
}

function createTriangles(p0, p1, p2, verts, lineWidth) {
	let t0 = sub(p1, p0);
	let t2 = sub(p2, p1);

	t0 = perpendicular(t0);
	t2 = perpendicular(t2);

	// triangle composed by the 3 points if clockwise or counter-clockwise.
	// if counter-clockwise, we must invert the line threshold points, otherwise
	// the intersection point could be erroneous and lead to odd results.
	if (signedArea(p0, p1, p2) > 0) {
		t0 = invert(t0);
		t2 = invert(t2);
	}

	t0 = normalize(t0);
	t2 = normalize(t2);
	t0 = scalarMult(t0, lineWidth);
	t2 = scalarMult(t2, lineWidth);

	const pintersect = lineIntersection(
		add(t0, p0),
		add(t0, p1),
		add(t2, p2),
		add(t2, p1));

	let anchor = null;
	let anchorLength = Number.MAX_VALUE;
	if (pintersect) {
		anchor = sub(pintersect, p1);
		anchorLength = length(anchor);
	}
	const p0p1 = sub(p0, p1);
	const p0p1Length = length(p0p1);
	const p1p2 = sub(p1, p2);
	const p1p2Length = length(p1p2);

	// the cross point exceeds any of the segments dimension.
	// do not use cross point as reference.
	if (anchorLength > p0p1Length || anchorLength > p1p2Length) {

		verts.push(add(p0, t0));
		verts.push(sub(p0, t0));
		verts.push(add(p1, t0));

		verts.push(sub(p0, t0));
		verts.push(add(p1, t0));
		verts.push(sub(p1, t0));

		createRoundCap(p1, add(p1,t0), add(p1,t2), p2, verts, lineWidth);

		verts.push(add(p2, t2));
		verts.push(sub(p1, t2));
		verts.push(add(p1, t2));

		verts.push(add(p2, t2));
		verts.push(sub(p1, t2));
		verts.push(sub(p2, t2));

	} else {

		verts.push(add(p0, t0));
		verts.push(sub(p0, t0));
		verts.push(sub(p1, anchor));

		verts.push(add(p0, t0));
		verts.push(sub(p1, anchor));
		verts.push(add(p1, t0));

		const _p0 = add(p1, t0);
		const _p1 = add(p1, t2);
		const _p2 = sub(p1, anchor);

		const center = p1;

		verts.push(_p0);
		verts.push(center);
		verts.push(_p2);

		createRoundCap(center, _p0, _p1, _p2, verts, lineWidth);

		verts.push(center);
		verts.push(_p1);
		verts.push(_p2);

		verts.push(add(p2, t2));
		verts.push(sub(p1, anchor));
		verts.push(add(p1, t2));

		verts.push(add(p2, t2));
		verts.push(sub(p1, anchor));
		verts.push(sub(p2, t2));
	}
}

const bufferPolyLine = function(points) {
	// const normals = polylineNormals(points);
	// const buffer = new Float32Array(points.length * 8);
	// for (let i=0; i<points.length; i++) {
	// 	const point = points[i];
	// 	const normal = normals[i][0];
	// 	const magnitude = normals[i][1];
	// 	// left position
	// 	buffer[i*8] = point[0];
	// 	buffer[i*8+1] = point[1];
	// 	// left normal
	// 	buffer[i*8+2] = normal[0] * magnitude;
	// 	buffer[i*8+3] = normal[1] * magnitude;
	// 	// right position
	// 	buffer[i*8+4] = point[0];
	// 	buffer[i*8+5] = point[1];
	// 	// right normal
	// 	buffer[i*8+6] = -normal[0] * magnitude;
	// 	buffer[i*8+7] = -normal[1] * magnitude;
	// }
	// return buffer;

	const buffer = new Float32Array(points.length * 2);
	for (let i=0; i<points.length; i++) {
		const point = points[i];
		buffer[i*2] = point[0];
		buffer[i*2+1] = point[1];
	}
	return buffer;
};

const bufferLine = function(points) {
	const buffer = new Float32Array(points.length * 12);
	for (let i=0; i<points.length; i+=3) {
		const a = points[i];
		const b = points[i+1];
		const c = points[i+2];
		// l0
		buffer[i*12] = a[0];
		buffer[i*12+1] = a[1];
		buffer[i*12+2] = b[0];
		buffer[i*12+3] = b[1];
		// l1
		buffer[i*12+4] = b[0];
		buffer[i*12+5] = b[1];
		buffer[i*12+6] = c[0];
		buffer[i*12+7] = c[1];
		// l2
		buffer[i*12+8] = c[0];
		buffer[i*12+9] = c[1];
		buffer[i*12+10] = a[0];
		buffer[i*12+11] = a[1];
	}
	return buffer;
};

const createVertexBuffer = function(gl, points) {
	const geometry = getStrokeGeometry(points);
	const data = bufferPolyLine(geometry);
	return new VertexBuffer(
		gl,
		data,
		{
			0: {
				size: 2,
				type: 'FLOAT',
				byteOffset: 0
			},
			// 1: {
			// 	size: 2,
			// 	type: 'FLOAT',
			// 	byteOffset: 2 * 4
			// }
		},
		{
			mode: 'TRIANGLES',
			count: geometry.length // 3
		});
};

const createLineBuffer = function(gl, points) {
	const geometry = getStrokeGeometry(points);
	const data = bufferLine(geometry);
	return new VertexBuffer(
		gl,
		data,
		{
			0: {
				size: 2,
				type: 'FLOAT',
				byteOffset: 0
			},
		},
		{
			mode: 'LINES',
			count: data.length / 2 // 3
		});
};
/**
 * Class representing an overlay.
 */
class WebGLLineOverlay extends WebGLOverlay {

	/**
	 * Instantiates a new WebGLLineOverlay object.
	 */
	constructor(options = {}) {
		super(options);
		this.lineColor = defaultTo(options.lineColor, [ 0.6, 0.0, 0.4, 1.0 ]);
		this.lineWidth = defaultTo(options.lineWidth, 2);
		this.polyLines = new Map();
		this.buffers = new Map();
		this.lines = new Map();
	}

	/**
	 * Executed when the overlay is attached to a plot.
	 *
	 * @param {Plot} plot - The plot to attach the overlay to.
	 *
	 * @returns {WebGLLineOverlay} The overlay object, for chaining.
	 */
	onAdd(plot) {
		super.onAdd(plot);
		this.shader = this.createShader(SHADER_GLSL);
		this.buffers = new Map();
		this.lines = new Map();
		if (this.polyLines.size > 0) {
			this.polyLines.forEach((points, id) => {
				const buffer = createVertexBuffer(this.gl, points);
				this.buffers.set(id, buffer);
				this.lines.set(id, createLineBuffer(this.gl, points));
			});
		}
		return this;
	}

	/**
	 * Executed when the overlay is removed from a plot.
	 *
	 * @param {Plot} plot - The plot to remove the overlay from.
	 *
	 * @returns {WebGLLineOverlay} The overlay object, for chaining.
	 */
	onRemove(plot) {
		super.onAdd(plot);
		this.shader = null;
		this.buffers = new Map();
		this.lines = new Map();
		return this;
	}

	/**
	 * Add a set of points to render as a single polyline.
	 *
	 * @param {String} id - The id to store the polyline under.
	 * @param {Array} points - The polyline points.
	 *
	 * @returns {WebGLLineOverlay} The overlay object, for chaining.
	 */
	addPolyLine(id, points) {
		this.polyLines.set(id, points);
		if (this.plot) {
			const buffer = createVertexBuffer(this.gl, points);
			this.buffers.set(id, buffer);
			this.lines.set(id, createLineBuffer(this.gl, points));
		}
		return this;
	}

	/**
	 * Remove a polyline by id from the overlay.
	 *
	 * @param {String} id - The id to store the polyline under.
	 *
	 * @returns {WebGLLineOverlay} The overlay object, for chaining.
	 */
	removePolyline(id) {
		this.polyLines.delete(id);
		if (this.plot) {
			this.buffers.delete(id);
		}
		return this;
	}

	/**
	 * Remove all polylines from the layer.
	 *
	 */
	clearPolylines() {
		this.polyLines = new Map();
		this.buffers = new Map();
	}

	/**
	 * The draw function that is executed per frame.
	 *
	 * @param {Number} timestamp - The frame timestamp.
	 *
	 * @returns {WebGLLineOverlay} The overlay object, for chaining.
	 */
	draw() {
		const gl = this.gl;
		const shader = this.shader;
		const buffers = this.buffers;
		const lines = this.lines;
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
		shader.setUniform('uLineColor', this.lineColor);
		//shader.setUniform('uLineWidth', this.lineWidth / 2);
		shader.setUniform('uExtent', extent);
		//shader.setUniform('uPixelRatio', plot.pixelRatio);

		// for each polyline buffer
		buffers.forEach(buffer => {
			// draw the points
			buffer.bind();
			buffer.draw();
		});

		shader.setUniform('uLineColor', [1.0, 1.0, 1.0, 1.0]);

		lines.forEach(buffer => {
			// draw the points
			buffer.bind();
			buffer.draw();
		});

		return this;
	}
}

module.exports = WebGLLineOverlay;
