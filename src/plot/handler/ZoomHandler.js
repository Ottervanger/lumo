'use strict';

const clamp = require('lodash/clamp');
const defaultTo = require('lodash/defaultTo');
const Browser = require('../../util/Browser');
const EventType = require('../../event/EventType');
const Event = require('../../event/Event');
const ZoomAnimation = require('../animation/ZoomAnimation');
const Viewport = require('../Viewport');
const DOMHandler = require('./DOMHandler');

// Constants

/**
 * Amount of scroll pixels per zoom level.
 *
 * @private
 * @constant {number}
 */
const ZOOM_WHEEL_DELTA = 300;

/**
 * Length of zoom animation in milliseconds.
 *
 * @private
 * @constant {number}
 */
const ZOOM_ANIMATION_MS = 250;

/**
 * Maximum concurrent discrete zooms in a single batch.
 *
 * @private
 * @constant {number}
 */
const MAX_CONCURRENT_ZOOMS = 4;

/**
 * Zoom debounce delay in miliseconds.
 *
 * @private
 * @constant {number}
 */
const ZOOM_DEBOUNCE_MS = 100;

/**
 * Continuous zoom enabled.
 *
 * @private
 * @constant {boolean}
 */
const CONTINUOUS_ZOOM = false;

// Private Methods

let last = Date.now();
const skipInterpolation = function(animation, delta) {
	// NOTE: attempt to determine if the scroll device is a mouse or a
	// trackpad. Mouse scrolling creates large infrequent deltas while
	// trackpads create tons of very small deltas. We want to interpolate
	// between wheel events, but not between trackpad events.
	const now = Date.now();
	const tdelta = now - last;
	last = now;
	if (delta % 4.000244140625 === 0) {
		// definitely a wheel, interpolate
		return false;
	}
	if (Math.abs(delta) < 4) {
		// definitely track pad, do not interpolate
		return true;
	}
	if (animation && animation.duration !== 0) {
		// current animation has interpolation, should probably interpolate
		// the next animation too.
		// NOTE: without this, rapid wheel scrolling will trigger the skip
		// below
		return false;
	}
	if (tdelta < 40) {
		// events are close enough together that we should probably
		// not interpolate
		return true;
	}
	return false;
};

const computeZoomDelta = function(wheelDelta, continuousZoom, deltaPerZoom, maxZooms) {
	let zoomDelta = wheelDelta / deltaPerZoom;
	if (!continuousZoom) {
		// snap value if not continuous zoom
		if (wheelDelta > 0) {
			zoomDelta = Math.ceil(zoomDelta);
		} else {
			zoomDelta = Math.floor(zoomDelta);
		}
	}
	// clamp zoom delta to max concurrent zooms
	return clamp(zoomDelta, -maxZooms, maxZooms);
};

const computeTargetZoom = function(zoomDelta, currentZoom, currentAnimation, minZoom, maxZoom) {
	let targetZoom;
	if (currentAnimation) {
		// append to existing animation target
		targetZoom = currentAnimation.targetZoom + zoomDelta;
	} else {
		targetZoom = currentZoom + zoomDelta;
	}
	// clamp the target zoom to min and max zoom level of plot
	return clamp(targetZoom, minZoom, maxZoom);
};

const zoom = function(plot, targetPos, zoomDelta, duration, relative = true) {
	// calculate target zoom level
	const targetZoom = computeTargetZoom(
		zoomDelta,
		plot.zoom,
		plot.zoomAnimation,
		plot.minZoom,
		plot.maxZoom);
  // set target viewport
	const targetViewport = plot.viewport.zoomToPos(
		plot.zoom,
		targetZoom,
		targetPos,
		relative);
	// get previous targets
	const prevTargetZoom = plot.getTargetZoom();
	const prevTargetViewport = plot.getTargetViewport();
	// only process zoom if it is required
	if (targetZoom !== prevTargetZoom ||
			targetViewport.x !== prevTargetViewport.x ||
			targetViewport.y !== prevTargetViewport.y) {
		// clear pan animation
		plot.panAnimation = null;
		// if there is a duration
		if (duration > 0) {
			// set zoom animation
			plot.zoomAnimation = new ZoomAnimation({
				plot: plot,
				duration: duration,
				prevZoom: plot.zoom,
				targetZoom: targetZoom,
				prevViewport: new Viewport(
						plot.viewport.x,
						plot.viewport.y,
						plot.viewport.width,
						plot.viewport.height),
				targetViewport: targetViewport,
				targetPos: targetPos
			});
		}
		// emit zoom start
		plot.emit(EventType.ZOOM_START, new Event(plot));
		// if there isn't a duration
		if (duration === 0) {
			// immediately update plot
			plot.zoom = targetZoom;
			plot.viewport = targetViewport;
			// emit zoom end
			plot.emit(EventType.ZOOM_END, new Event(plot));
		}
		// request tiles
		plot.zoomRequest();
	}
};

const zoomFromWheel = function(handler, plot, targetPos, wheelDelta, continuousZoom) {
	// no wheel delta, exit early
	if (wheelDelta === 0) {
		return;
	}
	// calculate zoom delta from wheel delta
	const zoomDelta = computeZoomDelta(
		wheelDelta,
		continuousZoom,
		handler.deltaPerZoom,
		handler.maxConcurrentZooms);
	// get duration
	let duration = handler.zoomDuration;
	if (continuousZoom && skipInterpolation(plot.zoomAnimation, wheelDelta)) {
		// skip animation interpolation
		duration = 0;
	}
	// process the zoom
	zoom(plot, targetPos, zoomDelta, duration);
};

const getWheelDelta = function(plot, event) {
	if (event.deltaMode === 0) {
		// pixels
		if (Browser.firefox) {
			return -event.deltaY / plot.pixelRatio;
		}
		return -event.deltaY;
	} else if (event.deltaMode === 1) {
		// lines
		return -event.deltaY * 20;
	}
	// pages
	return -event.deltaY * 60;
};

/**
 * Class representing a zoom handler.
 */
class ZoomHandler extends DOMHandler {

	/**
	 * Instantiates a new ZoomHandler object.
	 *
	 * @param {Plot} plot - The plot to attach the handler to.
	 * @param {object} options - The parameters of the animation.
	 * @param {number} options.continuousZoom - Whether or not continuous zoom is enabled.
	 * @param {number} options.zoomDuration - The duration of the zoom animation.
	 * @param {number} options.maxConcurrentZooms - The maximum concurrent zooms in a single batch.
	 * @param {number} options.deltaPerZoom - The scroll delta required per zoom level.
	 * @param {number} options.zoomDebounce - The debounce duration of the zoom in ms.
	 */
	constructor(plot, options = {}) {
		super(plot);
		this.continuousZoom = defaultTo(options.continuousZoom, CONTINUOUS_ZOOM);
		this.zoomDuration = defaultTo(options.zoomDuration, ZOOM_ANIMATION_MS);
		this.maxConcurrentZooms = defaultTo(options.maxConcurrentZooms, MAX_CONCURRENT_ZOOMS);
		this.deltaPerZoom = defaultTo(options.deltaPerZoom, ZOOM_WHEEL_DELTA);
		this.zoomDebounce = defaultTo(options.zoomDebounce, ZOOM_DEBOUNCE_MS);
	}

	/**
	 * Enables the handler.
	 *
	 * @returns {ZoomHandler} The handler object, for chaining.
	 */
	enable() {
		if (this.enabled) {
			return this;
		}

		const plot = this.plot;

		let wheelDelta = 0;
		let timeout = null;
		let evt = null;

		this.dblclick = (event) => {
			// get mouse position
			const targetPos = this.mouseToPlot(event);
			// zoom the plot by one level
			zoom(plot, targetPos, 1, this.zoomDuration);
		};

		this.wheel = (event) => {
			// get normalized delta
			const delta = getWheelDelta(plot, event);
			if (!this.continuousZoom && Math.abs(delta) < 4) {
				// mitigate the hyper sensitivty of a trackpad
				return;
			}
			// increment wheel delta
			wheelDelta += delta;
			// check zoom type
			if (this.continuousZoom) {
				// get target from mouse position
				const targetPos = this.mouseToPlot(event);
				// process continuous zoom immediately
				zoomFromWheel(this, plot, targetPos, wheelDelta, true);
				// reset wheel delta
				wheelDelta = 0;
			} else {
				// set event
				evt = event;
				// debounce discrete zoom
				if (!timeout) {
					timeout = setTimeout(() => {
						// get target position from mouse position
						// NOTE: this is called inside the closure to ensure
						// that we use the current viewport of the plot to
						// convert from mouse to plot pixels
						const targetPos = this.mouseToPlot(evt);
						// process zoom event
						zoomFromWheel(this, plot, targetPos, wheelDelta, false);
						// reset wheel delta
						wheelDelta = 0;
						// clear timeout
						timeout = null;
						// clear event
						evt = null;
					}, this.zoomDebounce);
				}
			}
			// prevent default behavior and stop propagationa
			event.preventDefault();
			event.stopPropagation();
		};

		let evCache = new Array();
		let pinchDistPrev = -1;

		this.pointerdown = (event) => {
			evCache.push(event);
			if (evCache.length === 2) {
				plot.pinchZoom = true;
				let dx = evCache[0].clientX - evCache[1].clientX;
				let dy = evCache[0].clientY - evCache[1].clientY;
				pinchDistPrev = Math.sqrt(dx*dx+dy*dy);
			}
		};

		this.pointermove = (event) => {
			// update cached pointer event
			for (var i = 0; i < evCache.length; i++) {
				if (event.pointerId === evCache[i].pointerId) {
					evCache[i] = event;
					break;
				}
			}

			if (evCache.length === 2) {
				let dx = evCache[0].clientX - evCache[1].clientX;
				let dy = evCache[0].clientY - evCache[1].clientY;
				let pinchDist = Math.sqrt(dx*dx+dy*dy);
				// let other = event.pointerId === evCache[0].pointerId ? evCache[1] : evCache[0];
				const targetPos = this.mouseToPlot({
					pageX: evCache[1].pageX + dx / 2,
					pageY: evCache[1].pageY + dy / 2});
				zoom(plot, targetPos, Math.log2(pinchDist/pinchDistPrev), 0);
				pinchDistPrev = pinchDist;
			}
		};

		this.pointerup = (event) => {
			for (var i = 0; i < evCache.length; i++) {
				if (evCache[i].pointerId === event.pointerId) {
					evCache.splice(i, 1);
				}
			}
			if (evCache.length < 2 && plot.pinchZoom === true) {
				plot.pinchZoom = null;
			}
		};

		this.pointerout = (event) => {
			for (var i = 0; i < evCache.length; i++) {
				if (evCache[i].pointerId === event.pointerId) {
					evCache.splice(i, 1);
				}
			}
		};

		const container = plot.getContainer();
		container.addEventListener('dblclick', this.dblclick);
		container.addEventListener('wheel', this.wheel);
		container.addEventListener('pointerdown', this.pointerdown);
		document.addEventListener('pointermove', this.pointermove);
		document.addEventListener('pointerup', this.pointerup);
		// container.addEventListener('pointerout', this.pointerout);
		return super.enable();
	}

	/**
	 * Disables the handler.
	 *
	 * @returns {ZoomHandler} The handler object, for chaining.
	 */
	disable() {
		if (!this.enabled) {
			return this;
		}

		const container = this.plot.getContainer();
		container.removeEventListener('dblclick', this.dblclick);
		container.removeEventListener('wheel', this.wheel);
		container.removeEventListener('pointerdown', this.pointerdown);
		container.removeEventListener('pointermove', this.pointermove);
		container.removeEventListener('pointerup', this.pointerup);
		container.removeEventListener('pointerout', this.pointerout);
		this.dblclick = null;
		this.wheel = null;
		this.pointerdown = null;
		this.pointermove = null;
		this.pointerup = null;
		this.pointerout = null;
		return super.disable();
	}

	/**
	 * Zooms in to the target zoom level. This is bounded by the plot objects
	 * minZoom and maxZoom attributes.
	 *
	 * @param {number} level - The target zoom level.
	 * @param {boolean} animate - Whether or not to animate the zoom. Defaults to `true`.
	 */
	zoomTo(level, animate = true) {
		const plot = this.plot;
		const targetPos = this.plot.getViewportCenter();
		const zoomDelta = level - plot.zoom;
		if (!animate) {
			// do not animate
			zoom(plot, targetPos, zoomDelta, 0);
		} else {
			// animate
			zoom(plot, targetPos, zoomDelta, this.zoomDuration);
		}
	}

	/**
	 * Zooms to the target zoom level, and centers on the target position.  The zoom is bounded by the plot objects
	 * minZoom and maxZoom attributes.
	 *
	 * @param {number} level - The target zoom level.
	 * @param {object} targetPos - The target center position.
	 * @param {boolean} animate - Whether or not to animate the zoom. Defaults to `true`.
	 */
	zoomToPosition(level, targetPos, animate = true) {
		const plot = this.plot;
		const zoomDelta = level - plot.zoom;
		const duration = animate ?  this.zoomDuration : 0;
		zoom(plot, targetPos, zoomDelta, duration, false /* centered on target position */);
	}
}

module.exports = ZoomHandler;
