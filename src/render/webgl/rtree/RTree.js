'use strict';

const rbush = require('rbush');
const defaultTo = require('lodash/defaultTo');
const CollisionType = require('./CollisionType');

/**
 * Class representing an r-tree.
 */
class RTree {

	/**
	 * Instantiates a new RTree object.
	 *
	 * @param {Object} options - The options object.
	 * @param {boolean} options.collisionType - The collision type of the points.
	 * @param {boolean} options.nodeCapacity - The node capacity of the r-tree.
	 */
	constructor(options) {
		this.collisionType = defaultTo(options.collisionType, CollisionType.CIRCLE);
		this.tree = rbush(defaultTo(options.nodeCapcity, 32));
	}

	/**
	 * Inserts an array of points into the r-tree.
	 *
	 * @param {Array} points - The array of points to insert.
	 */
	insert(points) {
		this.tree.load(points);
	}

	/**
	 * Removes an array of points from the r-tree.
	 *
	 * @param {Array} points - The array of points to remove.
	 */
	remove(points) {
		const tree = this.tree;
		for (let i=0; i<points.length; i++) {
			tree.remove(points[i]);
		}
	}

	/**
	 * Searchs the r-tree.
	 *
	 * @param {Number} x - The x component.
	 * @param {Number} y - The y component.
	 *
	 * @returns {Object} The collision object.
	 */
	search(x, y) {
		const collisions = this.tree.search({
			minX: x,
			maxX: x,
			minY: y,
			maxY: y
		});
		if (collisions.length === 0) {
			return null;
		}
		if (this.collisionType === CollisionType.RECTANGLE) {
			// rectangle, return result as is
			return collisions[0];
		}
		// do a circle check
		for (let i=0; i<collisions.length; i++) {
			const collision = collisions[i];
			// assume the boxes are squares
			const radius = (collision.maxX - collision.minX) / 2;
			// distance to center of square
			const dx = ((collision.minX + collision.maxX) * 0.5) - x;
			const dy = ((collision.minY + collision.maxY) * 0.5) - y;
			if ((dx * dx + dy * dy) <= (radius * radius)) {
				return collision;
			}
		}
		return null;
	}
}

module.exports = RTree;
