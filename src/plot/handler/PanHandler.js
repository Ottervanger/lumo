'use strict';

const defaultTo = require('lodash/defaultTo');
const PanAnimation = require('../animation/PanAnimation');
const EventType = require('../../event/EventType');
const Event = require('../../event/Event');
const DOMHandler = require('./DOMHandler');

// Constants

/**
 * Time in milliseconds before a pan point expires.
 *
 * @private
 * @constant {number}
 */
const PAN_EXPIRY_MS = 50;

/**
 * Pan inertia enabled.
 *
 * @private
 * @constant {boolean}
 */
const PAN_INTERTIA = true;

/**
 * Pan inertia easing.
 *
 * @private
 * @constant {number}
 */
const PAN_INTERTIA_EASING = 0.2;

/**
 * Pan inertia deceleration.
 *
 * @private
 * @constant {number}
 */
const PAN_INTERTIA_DECELERATION = 3400;

/**
 * Pan to animation duration
 *
 * @private
 * @constant {number}
 */
const PAN_TO_DURATION = 800;

// Private Methods

const pan = function(plot, delta) {
	if (plot.isZooming()) {
		// no panning while zooming
		return;
	}
	// update current viewport
	plot.viewport.x += delta.x;
	plot.viewport.y += delta.y;
	// request tiles
	plot.panRequest();
	// emit pan
	plot.emit(EventType.PAN, new Event(plot));
};

/**
 * Class representing a pan handler.
 */
class PanHandler extends DOMHandler {

	/**
	 * Instantiates a new PanHandler object.
	 *
	 * @param {Plot} plot - The plot to attach the handler to.
	 * @param {object} options - The parameters of the animation.
	 * @param {number} options.inertia - Whether or not pan inertia is enabled.
	 * @param {number} options.inertiaEasing - The inertia easing factor.
	 * @param {number} options.inertiaDeceleration - The inertia deceleration factor.
	 */
	constructor(plot, options = {}) {
		super(plot);
		this.inertia = defaultTo(options.inertia, PAN_INTERTIA);
		this.inertiaEasing = defaultTo(options.inertiaEasing, PAN_INTERTIA_EASING);
		this.inertiaDeceleration = defaultTo(options.inertiaDeceleration, PAN_INTERTIA_DECELERATION);
	}

	/**
	 * Enables the handler.
	 *
	 * @returns {PanHandler} The handler object, for chaining.
	 */
	enable() {
		if (this.enabled) {
			return this;
		}

		const plot = this.plot;

		let evCache = [];

		this.updateEvent = (oldEvent, event) => {
			event.positions = oldEvent.positions;
			event.times = oldEvent.times;
			event.lastPos = this.mouseToViewPx(oldEvent);
			return event;
		};

		this.pointerdown = (event) => {
			// ignore if right-button
			if (!this.isLeftButton(event)) {
				return;
			}
			evCache.push(event);
			if (this.inertia) {
				// clear existing pan animation
				plot.panAnimation = null;
				// reset position and time arrays
				event.positions = [];
				event.times = [];
			}
		};

		this.pointermove = (event) => {
			let down = false;
			// find and update the cached pointer event
			for (var i = 0; i < evCache.length; i++) {
				if (event.pointerId === evCache[i].pointerId) {
					evCache[i] = this.updateEvent(evCache[i], event);
					down = true;
					break;
				}
			}
			if (down) {
				// get latest position and timestamp
				let pos = this.mouseToViewPx(event);

				if (event.positions.length === 0) {
					// emit pan start
					plot.emit(EventType.PAN_START, new Event(plot));
				}

				if (this.inertia) {
					// add to position and time arrays
					event.positions.push(pos);
					event.times.push(event.timeStamp);
					// prevent array from getting too big
					if (event.timeStamp - event.times[0] > PAN_EXPIRY_MS) {
						event.positions.shift();
						event.times.shift();
					}
				}

				// calculate the positional delta
				const delta = {
					x: (event.lastPos.x - pos.x) / evCache.length,
					y: (event.lastPos.y - pos.y) / evCache.length
				};
				// pan the plot
				pan(plot, this.viewPxToPlot(delta));
			}
		};

		this.pointerup = (event) => {
			let match = false;
			for (var i = 0; i < evCache.length; i++) {
				if (evCache[i].pointerId === event.pointerId) {
					evCache[i] = this.updateEvent(evCache[i], event);
					evCache.splice(i, 1);
					match = true;
					break;
				}
			}

			if (!match) {
				// if original event is not found
				return;
			}

			if (plot.isZooming()) {
				// no panning while zooming
				return;
			}

			// ignore if right-button
			if (!this.isLeftButton(event)) {
				return;
			}

			// ignore if no drag occurred
			if (event.positions.length === 0) {
				return;
			}

			if (!this.inertia) {
				// exit early if no inertia or no movement
				plot.emit(EventType.PAN_END, new Event(plot));
				return;
			}

			// strip any positions that are too old
			while (event.timeStamp - event.times[0] > PAN_EXPIRY_MS) {
				event.positions.shift();
				event.times.shift();
			}

			if (event.times.length < 2) {
				// exit early if no remaining valid positions
				plot.emit(EventType.PAN_END, new Event(plot));
				return;
			}

			// shorthand
			const deceleration = this.inertiaDeceleration;
			const easing = this.inertiaEasing;

			// calculate direction from earliest to latest
			const direction = {
				x: event.lastPos.x - event.positions[0].x,
				y: event.lastPos.y - event.positions[0].y
			};
			// calculate the time difference
			const diff = ((event.timeStamp - event.times[0]) || 1) / 1000; // ms to s
			// calculate velocity
			const velocity = {
				x: direction.x * (easing / diff),
				y: direction.y * (easing / diff)
			};
			// calculate speed
			const speed = Math.sqrt(
				(velocity.x * velocity.x) +
				(velocity.y * velocity.y));
			// calculate panning duration
			const duration = speed / (deceleration * easing);
			// calculate inertia delta
			const delta = {
				x: Math.round(velocity.x * (-duration / 2)),
				y: Math.round(velocity.y * (-duration / 2))
			};
			// set pan animation
			plot.panAnimation = new PanAnimation({
				plot: plot,
				start: plot.getViewportPosition(),
				delta: this.viewPxToPlot(delta),
				easing: easing,
				duration: duration * 1000 // s to ms
			});
		};

		const container = plot.getContainer();
		container.addEventListener('pointerdown', this.pointerdown);
		document.addEventListener('pointermove', this.pointermove);
		document.addEventListener('pointerup', this.pointerup);
		return super.enable();
	}

	/**
	 * Disables the handler.
	 *
	 * @returns {PanHandler} The handler object, for chaining.
	 */
	disable() {
		if (!this.enabled) {
			return this;
		}

		const container = this.plot.getContainer();
		container.removeEventListener('pointerdown', this.pointerdown);
		document.removeEventListener('pointermove', this.pointermove);
		document.removeEventListener('pointerup', this.pointerup);
		this.pointerdown = null;
		this.pointermove = null;
		this.pointerup = null;
		return super.disable();
	}

	/**
	 * Pans to the target plot coordinate.
	 *
	 * @param {number} pos - The target plot position.
	 * @param {boolean} animate - Whether or not to animate the pan. Defaults to `true`.
	 */
	panTo(pos, animate = true) {
		const plot = this.plot;
		const center = plot.getViewportCenter();
		const delta = {
			x: pos.x - center.x,
			y: pos.y - center.y
		};
		if (!animate) {
			// do not animate
			plot.emit(EventType.PAN_START, new Event(plot));
			pan(plot, delta);
			plot.emit(EventType.PAN_END, new Event(plot));
		} else {
			// animate pan
			plot.emit(EventType.PAN_START, new Event(plot));
			plot.panAnimation = new PanAnimation({
				plot: plot,
				start: plot.getViewportPosition(),
				delta: delta,
				easing: this.inertiaEasing,
				duration: PAN_TO_DURATION
			});
		}
	}
}

module.exports = PanHandler;
