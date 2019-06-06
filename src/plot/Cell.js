'use strict';

const Bounds = require('../geometry/Bounds');

/**
 * The size of the cell, in pixels.
 * @private
 * @constant {number}
 */
const CELL_SIZE = Math.pow(2, 16);

/**
 * The half size of the cell, in pixels.
 * @private
 * @constant {number}
 */
const CELL_HALF_SIZE = CELL_SIZE / 2;

/**
 * Class representing a cell for clipping a rendering space.
 * @private
 */
class Cell {

	/**
	 * Instantiates a new Cell object.
	 *
	 * @param {number} zoom - The zoom the the cells is generated for.
	 * @param {object} center - The plot position of the center of the cell.
	 * @param {number} extent - The pixel extent of the plot at the time of generation.
	 */
	constructor(zoom, center, extent) {
		const halfSize = CELL_HALF_SIZE / extent;
		const offset = {
			x: center.x - halfSize,
			y: center.y - halfSize
		};
		this.zoom = zoom;
		this.halfSize = halfSize;
		this.center = center;
		this.offset = offset;
		this.extent = extent;
		this.bounds = new Bounds(
			center.x - halfSize,
			center.x + halfSize,
			center.y - halfSize,
			center.y + halfSize);
	}

	/**
	 * Project a normalized plot coordinate to the pixel space of the cell.
	 *
	 * @param {object} pos - The normalized plot coordinate.
	 * @param {number} zoom - The zoom of the plot pixel space to project to. Optional.
	 *
	 * @returns {object} The coordinate in cell pixel space.
	 */
	project(pos, zoom = this.zoom) {
		const scale = Math.pow(2, zoom - this.zoom) * this.extent;
		return {
			x: (pos.x - this.offset.x) * scale,
			y: (pos.y - this.offset.y) * scale
		};
	}

	/**
	 * Unproject a coordinate from the pixel space of the cell to a normalized
	 * plot coordinate.
	 *
	 * @param {object} px - The plot pixel coordinate.
	 * @param {number} zoom - The zoom of the plot pixel space to unproject from. Optional.
	 *
	 * @returns {object} The normalized plot coordinate.
	 */
	unproject(px, zoom = this.zoom) {
		const scale = Math.pow(2, zoom - this.zoom) * this.extent;
		return {
			x: (px.x / scale) + this.offset.x,
			y: (px.y / scale) + this.offset.y
		};
	}

}

module.exports = Cell;
