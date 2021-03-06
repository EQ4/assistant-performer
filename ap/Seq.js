/*
* Copyright 2012 James Ingram
* http://james-ingram-act-two.de/
*
* Code licensed under MIT
* https://github.com/notator/assistant-performer/blob/master/License.md
*
* ap/Seq.js
* The _AP.seq namespace containing:
* 
*        // Seq constructor
*        Seq(seqPositionInScore, inputChordIndices, seqTrks, trkOptions)
*
* Functions (in prototype): 
*
* 
*        // Called when a noteOn or noteOff starts this Seq.
*        // noteOff calls this function with no argument (undefined performedVelocity)      
*        start(performedVelocity)
* 
*        // Called when a noteOn or noteOff stops this Seq.
*        stop()  
*  
*        // sets the speed at which this Seq plays.     
*        setSpeedFactor(factor) 
*/

/*jslint bitwise: false, nomen: true, plusplus: true, white: true */
/*global _AP: false,  window: false,  document: false, performance: false, console: false, alert: false, XMLHttpRequest: false */


_AP.namespace('_AP.seq');

_AP.seq = (function()
{
	"use strict";
	var
	// A seq is an array of parallel trks. Each trk is a section of a track in the score.
	// Each Seq has the following attributes:
	// Used publicly at runtime: 
	//   seq.trks -- An array of trk.
	Seq = function(seqPositionInScore, trks, trackWorkers)
	{
		var workers;

		if(!(this instanceof Seq))
		{
			return new Seq(seqPositionInScore, trks, trackWorkers);
		}

		// Pushes trks into their respective worker's trk array and returns an array of worker.
		// The track parameters pushed are:
		//  msPosition
		//	moments // an array of moment. Each moment has a messages[] attribute and an msPositionInSeq attribute.
		//  trkOptions
		function setAndGetWorkers(seqPositionInScore, trks, trackWorkers)
		{
			var i, nTrks = trks.length, trkDef, trkWorker, workers = [], msPosition, moments, options;

			function getMoments(trkMidiObjects)
			{
				var i, j, nTrkMidiObjects, trkMoments, moment, trkMoment, midiObject, midiObjectMsPosInSeq;

				nTrkMidiObjects = trkMidiObjects.length;
				trkMoments = [];
				for(i = 0; i < nTrkMidiObjects; ++i)
				{
					midiObject = trkMidiObjects[i];
					midiObjectMsPosInSeq = midiObject.msPositionInScore - seqPositionInScore;
					for(j = 0; j < midiObject.moments.length; ++j)
					{
						moment = midiObject.moments[j];
						// midiRests have a single moment, but its messages array can be empty.
						if(moment.messages.length > 0)
						{
							trkMoment = {};
							if(moment.chordStart !== undefined)
							{
								trkMoment.chordStart = moment.chordStart;
							}
							if(moment.restStart !== undefined)
							{
								trkMoment.restStart = moment.restStart;
							}
							// all moments have an msPositionInChord attribute (even in midiRests)
							trkMoment.msPositionInSeq = midiObjectMsPosInSeq + moment.msPositionInChord;
							trkMoment.messages = moment.messages; // a clone of the messages is made when the trkMoment is transferred to the webWorker.
							trkMoments.push(trkMoment);
						}
					}
				}
				return trkMoments;
			}

			for(i = 0; i < nTrks; ++i)
			{
				trkDef = trks[i]; 

				msPosition = seqPositionInScore + trkDef.msOffset;
				moments = getMoments(trkDef.midiObjects);
				options = trkDef.trkOptions;

				// options must be a defined object having zero or more of the following attributes:
				//     pedal
				//     velocity (and minVelocity) -- both or neither is defined
				//     speed
				//     noteOff
				console.assert(options !== undefined, "Error: trkDef.trkOptions must be a valid object here.");

				trkWorker = trackWorkers[trkDef.trackIndex];

				trkWorker.postMessage({ action: "pushTrk", msPosition: msPosition, moments: moments, options: options });

				trkWorker.hasCompleted = false;

				workers.push(trkWorker);
			}
			return workers;
		}

		workers = setAndGetWorkers(seqPositionInScore, trks, trackWorkers);

		Object.defineProperty(this, "workers", { value: workers, writable: false });
	},

	API =
	{
		Seq: Seq // constructor
	};
	// end var

	// Called when a noteOn or noteOff starts this Seq.
	// If started by a noteOff, performedVelocity will be 0,
	// and any trk velocity options will be ignored!
	Seq.prototype.start = function(performedVelocity)
	{
		var i, worker, nWorkers = this.workers.length;

		for(i = 0; i < nWorkers; ++i)
		{
			worker = this.workers[i];
			// Maybe call
			//    setTimeout(...), 2);
			// to give the worker more time to stop.
			// (trackWorkers throw exceptions if they are busy when the following function is called.)
			worker.postMessage({ action: "start", velocity: performedVelocity });
		}
	};  

	return API;

}(window));




