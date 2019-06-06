'use strict';

const Bounds = require('../geometry/Bounds');
const TileCoord = require('../layer/tile/TileCoord');

// Private Methods

const getVisibleTileBounds = function(viewport, tileZoom, wraparound) {
	const bounds = viewport.getTileBounds(tileZoom);
	// min / max tile coords
	const dim = Math.pow(2, tileZoom);
	const min = 0;
	const max = dim - 1;
	// get the bounds of the zoom level
	const layerBounds = new Bounds(
		wraparound ? -Infinity : min,
		wraparound ? Infinity : max,
		min,
		max);
	// check if the layer is within the viewport
	if (!bounds.overlaps(layerBounds)) {
		// there is no overlap
		return undefined;
	}
	// clamp horizontal bounds if there is no wraparound
	const left = wraparound ? bounds.left : Math.max(min, bounds.left);
	const right = wraparound ? bounds.right : Math.min(max, bounds.right);
	// clamp vertical bounds
	const bottom = Math.max(min, bounds.bottom);
	const top = Math.min(max, bounds.top);
	return new Bounds(left, right, bottom, top);
};

const isWithinRange = function(min, max, m, n) {
	// Given:
	//    1) An integer range r = [min : max].
	//    2) An power-of-two integer m.
	//    3) An integer n within the within the range of [0 : m).
	//    4) An integer constant k.
	// Check if n, or any values of m +/- kn, is within the range R.
	//
	// Ex:
	//     min: -3
	//     max: 6
	//     m: 8
	//     n: 7
	//
	// Return true because 7 - 8 = -1, which is within the range -3 to 6.

	// within range
	if (min <= n && n <= max) {
		return true;
	}

	// if the range is above n, find how many m's fit
	// in the distance between n and min
	if (min > n) {
		const k = Math.ceil((min - n) / m);
		return n + k * m <= max;
	}

	// if the range is below n, find how many m's fit
	// in the distance between max and n
	const k = Math.ceil((n - max) / m);
	return n - k * m >= min;
};

/**
 * Class representing a viewport.
 */
class Viewport {

	/**
	 * Instantiates a new Viewport object.
	 *
	 * @param {number} x - The x coordinate of the viewport.
	 * @param {number} y - The y coordinate of the viewport.
	 * @param {number} width - The width of the viewport.
	 * @param {number} height - The height of the viewport.
	 */
	constructor(x, y, width, height) {
		this.x = x;
		this.y = y;
		this.width = width;
		this.height = height;
	}

	/**
	 * Returns the tile bounds of the viewport. Bounds edges are inclusive.
	 * NOTE: this includes wraparound coordinates.
	 *
	 * @param {number} tileZoom - The zoom of the tiles within the viewport.
	 *
	 * @returns {Bounds} The tile bounds of the viewport.
	 */
	getTileBounds(tileZoom) {
		// calc how many fit are in the plot
		const tileSpan = 1 / Math.pow(2, tileZoom);
		// determine bounds
		return new Bounds(
			Math.floor(this.x / tileSpan),
			Math.ceil((this.x + this.width) / tileSpan) - 1,
			Math.floor(this.y / tileSpan),
			Math.ceil((this.y + this.height) / tileSpan) - 1);
	}

	/**
	 * Returns the coordinates that are visible in the viewport.
	 *
	 * @param {number} tileZoom - The zoom of the tiles within the viewport. Optional.
	 * @param {boolean} wraparound - The if the horizontal axis should wraparound. Optional.
	 *
	 * @returns {Array} The array of visible tile coords.
	 */
	getVisibleCoords(tileZoom, wraparound = false) {
		// get the bounds for what tiles are in view
		const bounds = getVisibleTileBounds(this, tileZoom, wraparound);
		// check if no coords are in view
		if (!bounds) {
			return [];
		}
		// return an array of the coords
		const coords = [];
		for (let x=bounds.left; x<=bounds.right; x++) {
			for (let y=bounds.bottom; y<=bounds.top; y++) {
				coords.push(new TileCoord(tileZoom, x, y));
			}
		}
		return coords;
	}

	/**
	 * Returns whether or not the provided coord is within the viewport.
	 *
	 * @param {TileCoord} coord - The coord.
	 * @param {boolean} wraparound - The if the horizontal axis should wraparound. Optional.
	 *
	 * @returns {boolean} Whether or not the coord is in view.
	 */
	isInView(coord, wraparound = false) {
		// get the bounds for what tiles are in view
		const bounds = getVisibleTileBounds(this, coord.z, wraparound);
		// check if no coords are in view
		if (!bounds) {
			return false;
		}
		const dim = Math.pow(2, coord.z);
		return isWithinRange(bounds.left, bounds.right, dim, coord.x) &&
			isWithinRange(bounds.bottom, bounds.top, dim, coord.y);
	}

	/**
	 * Returns a viewport that has been zoomed around a provided position.
	 *
	 * @param {number} zoom - The current zoom of the viewport.
	 * @param {number} targetZoom - The target zoom of the viewport.
	 * @param {object} targetPos - The target position to zoom around.
	 * @param {boolean} relative - The target position is relative to the current position when true, and centered
	 * when false.  This paramater defaults to true.
	 *
	 * @returns {Viewport} The new viewport object.
	 */
	zoomToPos(zoom, targetZoom, targetPos, relative = true) {
		const scale = Math.pow(2, targetZoom - zoom);
		const scaledWidth = this.width / scale;
		const scaledHeight = this.height / scale;
		const viewport = new Viewport(
			targetPos.x - ((targetPos.x - this.x) / scale),
			targetPos.y - ((targetPos.y - this.y) / scale),
			scaledWidth,
			scaledHeight);
		if (!relative) {
			viewport.centerOn(targetPos);
		}
		return viewport;
	}

	/**
	 * Returns the lower-left corner position of the viewport in plot
	 * coordinates.
	 *
	 * @returns {object} The plot position.
	 */
	getPosition() {
		return {
			x: this.x,
			y: this.y
		};
	}

	/**
	 * Returns the center of the viewport in plot coordinates.
	 *
	 * @returns {object} The plot center.
	 */
	getCenter() {
		return {
			x: this.x + this.width / 2,
			y: this.y + this.height / 2
		};
	}

	/**
	 * Returns the viewports size in pixels.
	 *
	 * @param {number} zoom - The zoom of the plot.
	 * @param {number} tileSize - The size of a tile in pixels.
	 *
	 * @returns {object} The view size in pixels.
	 */
	getPixelSize(zoom, tileSize) {
		const extent = Math.pow(2, zoom) * tileSize;
		return {
			width: Math.round(this.width * extent),
			height: Math.round(this.height * extent)
		};
	}

	/**
	 * Returns the viewports offset in pixels.
	 *
	 * @param {number} zoom - The zoom of the plot.
	 * @param {number} tileSize - The size of a tile in pixels.
	 *
	 * @returns {object} The view offset in pixels.
	 */
	getPixelOffset(zoom, tileSize) {
		const extent = Math.pow(2, zoom) * tileSize;
		return {
			x: this.x * extent,
			y: this.y * extent
		};
	}

	/**
	 * Centers the viewport on a given plot coordinate.
	 *
	 * @param {object} pos - The position to center the viewport on.
	 *
	 * @returns {Viewport} The viewport object, for chaining.
	 */
	centerOn(pos) {
		this.x = pos.x - this.width / 2;
		this.y = pos.y - this.height / 2;
	}
}

module.exports = Viewport;
