/*
*  copyright 2012 James Ingram
*  http://james-ingram-act-two.de/
*
*  Code licensed under MIT
*  https://github.com/notator/assistant-performer/blob/master/License.md
*
*  ap/Score.js
*  The _AP.score namespace which defines the
*	Score(callback) constructor.
*  
*/


/*jslint bitwise: false, nomen: true, plusplus: true, white: true */
/*global _AP: false,  window: false,  document: false, performance: false, console: false, alert: false, XMLHttpRequest: false */

_AP.namespace('_AP.score');

_AP.score = (function (document)
{
	"use strict";

	var 
	CMD = _AP.constants.COMMAND,
	Message = _AP.message.Message,
	Track = _AP.track.Track,
	Sequence = _AP.sequence.Sequence,

	Markers = _AP.markers,
	ChordDef = _AP.chordDef.ChordDef,
	MidiChord = _AP.midiChord.MidiChord,
	MidiRest = _AP.midiRest.MidiRest,

	MAX_MIDI_CHANNELS = 16,

	// The frames around each svgPage
	svgFrames = [],

	viewBoxScale,

	// See comments in the publicAPI definition at the bottom of this file.
	systems = [], // an array of all the systems

	// Initially there is no assistant (a non-assisted performance).
	// This value is changed when/if the assistant has been constructed.
	// It is used to determine whether this is an assisted performance or not,
	// and when setting the position of the end marker in assisted performances.
	livePerformersTrackIndex = -1,

	livePerformersSoundingTrack = null,
	livePerformersSilentTrack = null,

	// callback: trackIsOn(trackIndex) returns a boolean which is the yes/no playing status of the track
	// This callback is used at Score construction time.
	trackIsOn = null,

	startMarker,
	runningMarker,
	endMarker,
	runningMarkerHeightChanged, // callback, called when runningMarker changes systems

	finalBarlineInScore,

	// Sends a noteOff to all notes on all channels on the midi output device.
	allNotesOff = function (midiOutputDevice)
	{
		var 
		noteOffMessage, channelIndex, noteIndex,
		now = performance.now();

		if (midiOutputDevice !== undefined && midiOutputDevice !== null)
		{
			for (channelIndex = 0; channelIndex < MAX_MIDI_CHANNELS; ++channelIndex)
			{
				for (noteIndex = 0; noteIndex < 128; ++noteIndex)
				{
					noteOffMessage = new Message(CMD.NOTE_OFF + channelIndex, noteIndex, 127);
					midiOutputDevice.send(noteOffMessage.data, now);
				}
			}
		}
	},

	hideStartMarkersExcept = function (startMarker)
	{
		var i, sMarker;
		for (i = 0; i < systems.length; ++i)
		{
			sMarker = systems[i].startMarker;
			if (sMarker === startMarker)
			{
				sMarker.setVisible(true);
			}
			else
			{
				sMarker.setVisible(false);
			}
		}
	},

	hideEndMarkersExcept = function (endMarker)
	{
		var i, eMarker;
		for (i = 0; i < systems.length; ++i)
		{
			eMarker = systems[i].endMarker;
			if (eMarker === endMarker)
			{
				eMarker.setVisible(true);
			}
			else
			{
				eMarker.setVisible(false);
			}
		}
	},

	getTimeObjectsArray = function (system)
	{
		var i, nStaves = system.staves.length, j, nVoices, timeObjects, timeObjectsArray = [];

		for (i = 0; i < nStaves; ++i)
		{
			nVoices = system.staves[i].voices.length;
			for (j = 0; j < nVoices; ++j)
			{
				timeObjects = system.staves[i].voices[j].timeObjects;
				timeObjectsArray.push(timeObjects);
			}
		}
		return timeObjectsArray;
	},

	// Algorithm:
	// clickedX = timeObject.alignmentX.
	// If timeObject is in a performing track:
	// { If it is a chord, return it, 
	//	  else if the following object is a chord, return that
	//	  else if the following object is the final barline, return the last chord in the track 
	// }
	// Otherwise do the same for performing tracks successively above.
	// If that does not work, try the tracks successively below.
	findStartMarkerTimeObject = function (timeObject, clickedTrackIndex, system, trackIsOn)
	{
		var returnedTimeObject, trackIndex, diff, timeObjectsArray;

		// Returns the chord timeObject at alignmentX, or the following object in the track (if it is a chord), or null.
		// If the timeObject following alignmentX is the final barline, the last chord in the track is returned.
		function nextChordTimeObject(timeObjects, alignmentX)
		{
			var i, nTimeObjects = timeObjects.length,
			returnTimeObject = null, tObject, lastChordTimeObject;

			for (i = 0; i < nTimeObjects; ++i)
			{
				tObject = timeObjects[i];
				if (tObject.chordDef !== undefined)
				{
					lastChordTimeObject = tObject;
				}
				if (i === (nTimeObjects - 1))
				{
					returnTimeObject = lastChordTimeObject;
					break;
				}
				if (tObject.alignmentX >= alignmentX && (tObject.chordIndex !== undefined || tObject.chordDef !== undefined))
				{
					returnTimeObject = tObject;
					break;
				}
				if (tObject.alignmentX > alignmentX)
				{
					break;
				}
			}
			return returnTimeObject;
		}

		timeObjectsArray = getTimeObjectsArray(system);
		returnedTimeObject = null;
		trackIndex = clickedTrackIndex;
		diff = -1;
		while (returnedTimeObject === null && trackIndex >= 0)
		{
			if (trackIsOn(trackIndex))
			{
				returnedTimeObject = nextChordTimeObject(timeObjectsArray[trackIndex], timeObject.alignmentX);
			}
			if (returnedTimeObject === null)
			{
				trackIndex += diff;
				if (trackIndex < 0)
				{
					trackIndex = clickedTrackIndex + 1;
					diff = 1;
				}
				if (diff === 1 && trackIndex === timeObjectsArray.length)
				{
					throw "Error: there must be at least one chord on the system!";
				}
			}
		}

		return returnedTimeObject;
	},

	// This function is called by the Controls whenever the score's display needs to be updated.
	// It draws the staves with the right colours and, if necessary, moves the start marker to a chord.
	// If necessary, it also sets sequence.tracks[ livePerformersTrackIndex] to be silent.
	refreshDisplay = function (sequence, isAssistedPerformance, livePerformersTrackIndex, livePerformerIsSilent)
	{
		var system = systems[startMarker.systemIndex()],
		timeObject = startMarker.timeObject(),
		timeObjectsArray = getTimeObjectsArray(system),
		timeObjectTrackIndex;

		function findTrackIndex(timeObjectsArray, timeObject)
		{
			var i, nTracks = timeObjectsArray.length, j, nTimeObjects, returnIndex = -1;
			for (i = 0; i < nTracks; ++i)
			{
				nTimeObjects = timeObjectsArray[i].length;
				for (j = 0; j < nTimeObjects; ++j)
				{
					if (timeObject === timeObjectsArray[i][j])
					{
						returnIndex = i;
						break;
					}
				}
				if (returnIndex >= 0)
				{
					break;
				}
			}
			if (returnIndex === -1)
			{
				throw "Error: timeObject not found in system.";
			}
			return returnIndex;
		}

		function thereIsNoPerformingChordOnTheStartBarline(timeObjectsArray, alignmentX, trackIsOn)
		{
			var i, nTracks = timeObjectsArray.length, j, nTimeObjects,
				timeObjectFound = false;

			for (i = 0; i < nTracks; ++i)
			{
				if (trackIsOn(i))
				{
					nTimeObjects = timeObjectsArray[i].length;
					for (j = 0; j < nTimeObjects; ++j)
					{
						if (alignmentX === timeObjectsArray[i][j].alignmentX)
						{
							timeObjectFound = true;
							break;
						}

						if(alignmentX < timeObjectsArray[i][j].alignmentX)
						{
							break;
						}
					}
				}
			}

			return (!timeObjectFound);
		}

		// Staves can have either one or two voices (=tracks). The tracks are 0-indexed channels from top
		// to bottom of the system.
		// If a staff has one track (=voice)
		//	  if it is the live performer's track,
		//		  if its sounds are to be played, its stafflines are coloured black, else
		//		  (conductor option) its stafflines are coloured blue.
		//	  if it is an assistant's track
		//		  if the track is to be played, its stafflines are coloured grey, else
		//		  if the track is disabled, its stafflines are coloured light red.
		// When the staff has two tracks. Then the top three stafflines are coloured for the upper track,
		// and the lower two lines are coloured for the lower track. 
		function setView(isAssistedPerformance, livePerformersTrackIndex, livePerformerIsSilent, trackIsOn)
		{
			function setLivePerformersTitleColor(isAssistedPerformance, livePerformersTrackIndex)
			{
				var i, nSystems = systems.length, j, nStaves = systems[0].staves.length,
				k, staff, nVoices, track, LIVE_PERFORMERS_TITLECOLOR = "#8888FF";

				for(i = 0; i < nSystems; ++i)
				{
					track = 0;
					for(j = 0; j < nStaves; ++j)
					{
						staff = systems[i].staves[j];
						if(isAssistedPerformance && track === livePerformersTrackIndex)
						{
							staff.nameElem.style.fill = LIVE_PERFORMERS_TITLECOLOR;
							staff.nameElem.style.fontWeight = 'bold';
						}
						else
						{
							staff.nameElem.style.fill = '#000000';
							staff.nameElem.style.fontWeight = 'normal';
						}
						nVoices = staff.voices.length;
						for(k = 0; k < nVoices; ++k)
						{
							++track;
						}
					}
				}
			}

			function setStafflineColors(isAssistedPerformance, livePerformersTrackIndex, livePerformerIsSilent, trackIsOn)
			{
				var i, nSystems = systems.length, j, nStaves = systems[0].staves.length,
				k, staff, trackIndex, m, nLines,
				stafflineColor;

				function getStafflineColor(trackIndex, isAssistedPerformance, livePerformersTrackIndex, livePerformerIsSilent, trackIsOn)
				{
					var
					color,
					BLACK_COLOR = "#000000",
					ASSISTED_GREY_STAFFCOLOR = "#7888A0",
					SILENT_LIVEPERFORMER_STAFFCOLOR = "#0033CC",
					DISABLED_PINK_STAFFCOLOR = "#FFAAAA";

					if(trackIsOn(trackIndex))
					{
						if(!isAssistedPerformance)
						{
							color = BLACK_COLOR;
						}
						else if(trackIndex === livePerformersTrackIndex)
						{
							if(livePerformerIsSilent === true)
							{
								color = SILENT_LIVEPERFORMER_STAFFCOLOR;
							}
							else
							{
								color = BLACK_COLOR;
							}
						}
						else
						{
							color = ASSISTED_GREY_STAFFCOLOR;
						}
					}
					else
					{
						color = DISABLED_PINK_STAFFCOLOR;
					}
					return color;
				}

				for(i = 0; i < nSystems; ++i)
				{
					trackIndex = 0;
					for(j = 0; j < nStaves; ++j)
					{
						staff = systems[i].staves[j];
						if(staff.voices.length === 1)
						{
							stafflineColor = getStafflineColor(trackIndex, isAssistedPerformance, livePerformersTrackIndex, livePerformerIsSilent, trackIsOn);
							nLines = staff.svgStafflines.length;
							for(m = 0; m < nLines; ++m) // could be any number of lines
							{
								staff.svgStafflines[m].style.stroke = stafflineColor;
							}
							++trackIndex;
						}
						else if(staff.voices.length === 2 && staff.svgStafflines.length === 5) // the staff has two voices
						{
							for(k = 0; k < 2; ++k)
							{
								stafflineColor = getStafflineColor(trackIndex, isAssistedPerformance, livePerformersTrackIndex, livePerformerIsSilent, trackIsOn);
								if(k === 0)
								{
									staff.svgStafflines[0].style.stroke = stafflineColor;
									staff.svgStafflines[1].style.stroke = stafflineColor;
									staff.svgStafflines[2].style.stroke = stafflineColor;
								}
								if(k === 1)
								{
									staff.svgStafflines[3].style.stroke = stafflineColor;
									staff.svgStafflines[4].style.stroke = stafflineColor;
								}
								++trackIndex;
							}
						}
						else
						{
							throw "Error: staff cannot have more than two voices! Two voice staves must have five lines.";
						}
					}
				}
			}

			setLivePerformersTitleColor(isAssistedPerformance, livePerformersTrackIndex);
			setStafflineColors(isAssistedPerformance, livePerformersTrackIndex, livePerformerIsSilent, trackIsOn);
		}

		setView(isAssistedPerformance, livePerformersTrackIndex, livePerformerIsSilent, trackIsOn); // marks the disabled tracks

		if(isAssistedPerformance === true)
		{
			if(livePerformerIsSilent === true)
			{
				sequence.tracks[livePerformersTrackIndex] = livePerformersSilentTrack;
			}
			else
			{
				sequence.tracks[livePerformersTrackIndex] = livePerformersSoundingTrack;
			}
		}

		// move the start marker if necessary
		if (thereIsNoPerformingChordOnTheStartBarline(timeObjectsArray, timeObject.alignmentX, trackIsOn))
		{
			timeObjectTrackIndex = findTrackIndex(timeObjectsArray, timeObject);
			timeObject = findStartMarkerTimeObject(timeObject, timeObjectTrackIndex, system, trackIsOn);

			if (timeObject.msPosition < endMarker.msPosition())
			{
				startMarker.moveTo(timeObject);
			}
		}
	},

	getTrackIsOnCallback = function (trackIsOnCallback)
	{
		// trackIsOn(trackIndex) returns a boolean which is the yes/no playing status of the track
		trackIsOn = trackIsOnCallback;

	},

	// this function is called only when state is 'settingStart' or 'settingEnd'.
	svgPageClicked = function (e, state)
	{
		var frame = e.target,
			x = e.pageX,
			y = e.pageY + frame.originY,
			systemIndex, system,
			staffIndex, voiceIndex, timeObject;

		// x and y now use the <body> element as their frame of reference.
		// this is the same frame of reference as in the systems.
		// systems is a single global array (inside this namespace)of all systems.
		// This is important when identifying systems, and when performing.

		// Returns either the live performer's staff index or voice index, depending
		// on the value of the returnStaffIndex argument.
		function livePerformersIndex(system, livePerformersTrackIndex, returnStaffIndex)
		{
			var staff, rStaffIndex, rVoiceIndex, trackIndex = 0, returnIndex = -1;

			for(rStaffIndex = 0; rStaffIndex < system.staves.length; ++rStaffIndex)
			{
				staff = system.staves[rStaffIndex];
				for(rVoiceIndex = 0; rVoiceIndex < staff.voices.length; ++rVoiceIndex)
				{
					if(trackIndex === livePerformersTrackIndex)
					{
						if(returnStaffIndex)
						{
							returnIndex = rStaffIndex;
						}
						else
						{
							returnIndex = rVoiceIndex;
						}
						break;
					}
					++trackIndex;
				}
				if(returnIndex >= 0)
				{
					break;
				}
			}
			if(returnIndex < 0)
			{
				throw "livePerformersTrackIndex must be on the system!";
			}
			return returnIndex;
		}

		function livePerformersStaffIndex(system, livePerformersTrackIndex)
		{
			return livePerformersIndex(system, livePerformersTrackIndex, true);
		}

		function livePerformersVoiceIndex(system, livePerformersTrackIndex)
		{
			return livePerformersIndex(system, livePerformersTrackIndex, false);
		}

		// Returns the system having stafflines closest to y.
		function findSystemIndex(y)
		{
			var i, topLimit, bottomLimit, systemIndex1;

			if (systems.length === 1)
			{
				systemIndex1 = 0;
			}
			else
			{
				topLimit = -1;
				for (i = 0; i < systems.length - 1; ++i)
				{
					bottomLimit = (systems[i].bottomLineY + systems[i + 1].topLineY) / 2;
					if (y >= topLimit && y < bottomLimit)
					{
						systemIndex1 = i;
						break;
					}
					topLimit = bottomLimit;
				}

				if (systemIndex1 === undefined)
				{
					systemIndex1 = systems.length - 1; // last system
				}
			}
			return systemIndex1;
		}

		// Returns the index of the staff having stafflines closest to y
		function findStaffIndex(y, staves)
		{
			var rStaffIndex, i, nStaves, topLimit, bottomLimit;

			if (y <= staves[0].bottomLineY)
			{
				rStaffIndex = 0;
			}
			else if (y >= staves[staves.length - 1].topLineY)
			{
				rStaffIndex = staves.length - 1;
			}
			else
			{
				nStaves = staves.length;
				for (i = 1; i < nStaves; ++i)
				{
					topLimit = staves[i - 1].bottomLineY;
					bottomLimit = staves[i].topLineY;
					if (y >= topLimit && y <= bottomLimit)
					{
						rStaffIndex = ((y - topLimit) < (bottomLimit - y)) ? i - 1 : i;
						break;
					}

					if (y >= staves[i].topLineY && y <= staves[i].bottomLineY)
					{
						rStaffIndex = i;
						break;
					}
				}
			}
			return rStaffIndex;
		}

		// Returns the index of the voice closest to y
		function findVoiceIndex(y, voices)
		{
			var index, nVoices = voices.length, midY;
			if (nVoices === 1)
			{
				index = 0;
			}
			else
			{
				midY = (voices[0].centreY + voices[1].centreY) / 2;
				index = (y < midY) ? 0 : 1;
			}
			return index;
		}

		// Returns the index of the first chord or rest or final barline whose alignmentX is >= x
		// if x is greater than all alignmentXs, returns undefined
		function findTimeObject(x, timeObjects)
		{
			var i, rTimeObject, nTimeObjects = timeObjects.length;
			for (i = 0; i < nTimeObjects; ++i)
			{
				if (timeObjects[i].alignmentX >= x)
				{
					rTimeObject = timeObjects[i];
					break;
				}
			}

			return rTimeObject;
		}

		function isChord(timeObject)
		{
			if(timeObject.chordIndex !== undefined || timeObject.chordDef !== undefined)
			{
				return true;
			}
			return false;
		}

		// In a performance without live performer, returns the timeObject argument unchanged.
		// In a performance with live performer:
		//	  If the timeObject is a chord or rest, or is the final barline on the final system, return it unchanged.
		//	  If the timeObject is not on the final system, and is the final barline in the voice:
		//		  If the next timeObject after the barline in the same voice has the same position, return the final barline unchanged
		//		  Else if the previous timeObject is later than the startMarker, return the previous timeObject
		//		  Else return null. 
		function getEndMarkerTimeObject(timeObject, systems, systemIndex, staffIndex, voiceIndex)
		{
			var timeObjects, returnedTimeObject = null;

			function isFinalSystem(systems, systemIndex)
			{
				return systemIndex === systems.length - 1;
			}

			function firstTimeObjectInNextSystemHasSameMsPos(finalBarlineMsPos, systems, nextSystemIndex, staffIndex, voiceIndex)
			{
				var nextSystemTimeObjects, nextSystemFirstTimeObjectPos;
				
				nextSystemTimeObjects = systems[nextSystemIndex].staves[staffIndex].voices[voiceIndex].timeObjects;
				nextSystemFirstTimeObjectPos = nextSystemTimeObjects[0].msPosition;

				return finalBarlineMsPos === nextSystemFirstTimeObjectPos;
			}

			// note that startMarkerMsPos can be on an earlier system
			function penultimateTimeObjectLaterThanStartMarker(startMarkerMsPos, timeObjects)
			{
				var pTOROSM = null, tObj;

				if(timeObjects.length > 2)
				{
					tObj = timeObjects[timeObjects.length - 2];
					if(tObj.msPosition > startMarkerMsPos)
					{
						pTOROSM = tObj;
					}
				}
				return pTOROSM;
			}

			if(livePerformersTrackIndex === -1)
			{
				returnedTimeObject = timeObject;
			}
			else // with live performer
			{
				if(timeObject.msDuration !== 0 || isFinalSystem(systems, systemIndex))
				{
					returnedTimeObject = timeObject;
				}
				else // timeObject.msDuration === 0 && ! final system
				{
					if(firstTimeObjectInNextSystemHasSameMsPos(timeObject.msPosition, systems, systemIndex+1, staffIndex, voiceIndex))
					{
						returnedTimeObject = timeObject;
					}
					else
					{
						timeObjects = systems[systemIndex].staves[staffIndex].voices[voiceIndex].timeObjects;
						returnedTimeObject = penultimateTimeObjectLaterThanStartMarker(startMarker.msPosition(), timeObjects);
					}
					// returnedTimeObject can be null
				}
			}
			return returnedTimeObject;
		}

		// If the timeObject is a chord, return it unchanged.
		// If the timeObject is a rest, return the following chord.
		// If the timeObject is the final barline, or there are no chords following the rest, return null.
		function getStartMarkerChordObject(timeObject, timeObjects )
		{
			var returnedChord = null, found, i;

			if(isChord(timeObject))
			{
				returnedChord = timeObject;
			}
			else if(!(timeObject === timeObjects[timeObjects.length - 1]))
			{
				// a rest
				found = false;
				for(i = 0; i < timeObjects.length; ++i)
				{
					if(timeObjects[i] === timeObject)
					{
						found = true;
					}
					else if(found && isChord(timeObjects[i]))
					{
						returnedChord = timeObjects[i];
						break;
					}
				}
			}

			return returnedChord;
		}

		systemIndex = findSystemIndex(y);
		if (systemIndex !== undefined)
		{
			system = systems[systemIndex];
			if(livePerformersTrackIndex >= 0)
			{
				staffIndex = livePerformersStaffIndex(system, livePerformersTrackIndex);
				voiceIndex = livePerformersVoiceIndex(system, livePerformersTrackIndex);
			}
			else
			{
				staffIndex = findStaffIndex(y, system.staves);
				voiceIndex = findVoiceIndex(y, system.staves[staffIndex].voices);
			}
			timeObject = findTimeObject(x, system.staves[staffIndex].voices[voiceIndex].timeObjects);

			// timeObject is now the next object to the right of the click,
			// either in the live performers voice (if there is one) or in the clicked voice.
			// The object can be a chord or rest or the final barline on the voice. 

			if(state === "settingEnd")
			{
				timeObject = getEndMarkerTimeObject(timeObject, systems, systemIndex, staffIndex, voiceIndex);
			}
			if (state === "settingStart")
			{
				// If the timeObject is a chord, return it unchanged.
				// If it is a rest, return the following chord.
				// Returns null if unsuccessful.
				timeObject = getStartMarkerChordObject(timeObject, system.staves[staffIndex].voices[voiceIndex].timeObjects );
			}

			if(timeObject !== null)
			{
				switch(state)
				{
					case 'settingStart':
						if(timeObject.msPosition < endMarker.msPosition())
						{
							startMarker = system.startMarker;
							hideStartMarkersExcept(startMarker);
							startMarker.moveTo(timeObject);
						}
						break;
					case 'settingEnd':
						if(startMarker.msPosition() < timeObject.msPosition)
						{
							endMarker = system.endMarker;
							hideEndMarkersExcept(endMarker);
							endMarker.moveTo(timeObject);
						}
						break;
					default:
						break;
				}
			}
		}
	},

	showRunningMarker = function ()
	{
		runningMarker.setVisible(true);
	},

	hideRunningMarkers = function ()
	{
		var i, nSystems = systems.length;
		for (i = 0; i < nSystems; ++i)
		{
			systems[i].runningMarker.setVisible(false);
		}
	},

	moveRunningMarkerToStartMarker = function ()
	{
		hideRunningMarkers();
		runningMarker = systems[startMarker.systemIndex()].runningMarker;
		runningMarker.moveToStartMarker(startMarker);
	},

	// Called when the go button is clicked.
	setRunningMarkers = function ()
	{
		var sysIndex, nSystems = systems.length, system;

		for (sysIndex = 0; sysIndex < nSystems; ++sysIndex)
		{
			system = systems[sysIndex];
			system.runningMarker.setTimeObjects(system, trackIsOn);
		}
		moveRunningMarkerToStartMarker();
		showRunningMarker();
	},

	// The svg argument contains pointers to functions that work on the SVG score.
	// Constructs all pages, complete except for the timeObjects.
	// Each page has a frame and the correct number of empty systems.
	// Each system has the correct number of empty staves and barlines, it also has
	// a startMarker, a runningMarker and an endMarker.
	// Each staff has empty voices, each voice has an empty timeObjects array.
	// If these objects have graphic parameters, they are set.
	getEmptyPagesAndSystems = function (svg)
	{
		var system, embeddedSvgPages, nPages, viewBoxOriginY,
			i, j,
			sysNumber, svgPage, svgElem, svgChildren, systemID,
			childClass, currentFrame, pageHeight;

		function resetContent()
		{
			while (svgFrames.length > 0)
			{
				svgFrames.pop();
			}
			while (systems.length > 0)
			{
				systems.pop();
			}
		}

		function getEmptySystem(viewBoxOriginY, viewBoxScale, systemNode)
		{
			var i, j, k, systemChildren, childClass,
				staff, staffChildren, staffChildClass, stafflineInfo,
				markersChildren, barlinesChildren, voice, voiceChildren, voiceChild;

			// returns an info object containing left, right and stafflineYs
			function getStafflineInfo(stafflines)
			{
				var i, rStafflineInfo = {}, stafflineYs = [], left, right, stafflineY,
				svgStaffline, svgStafflines = [];

				for (i = 0; i < stafflines.length; ++i)
				{
					if (stafflines[i].nodeName !== '#text')
					{
						svgStaffline = stafflines[i];
						svgStafflines.push(svgStaffline);
						stafflineY = parseFloat(svgStaffline.getAttribute('y1'));
						stafflineYs.push((stafflineY / viewBoxScale) + viewBoxOriginY);
						left = parseFloat(svgStaffline.getAttribute('x1'));
						left /= viewBoxScale;
						right = parseFloat(svgStaffline.getAttribute('x2'));
						right /= viewBoxScale;
					}
				}
				rStafflineInfo.left = left;
				rStafflineInfo.right = right;
				rStafflineInfo.stafflineYs = stafflineYs;
				rStafflineInfo.svgStafflines = svgStafflines;

				return rStafflineInfo;
			}

			function getGap(gap, stafflineYs)
			{
				var newGap = gap;
				if (newGap === undefined && stafflineYs.length > 1)
				{
					newGap = stafflineYs[1] - stafflineYs[0];
					if (newGap < 0)
					{
						newGap *= -1;
					}
				}
				return newGap;
			}

			function setVoiceCentreYs(staffTopY, staffBottomY, voices)
			{
				if (voices.length === 1)
				{
					voices[0].centreY = (staffTopY + staffBottomY) / 2;
				}
				else // voices.length === 2
				{
					voices[0].centreY = staffTopY;
					voices[1].centreY = staffBottomY;
				}
			}

			system = {};
			system.staves = [];
			systemChildren = systemNode.childNodes;
			for (i = 0; i < systemChildren.length; ++i)
			{
				if (systemChildren[i].nodeName !== '#text')
				{
					childClass = systemChildren[i].getAttribute("class");
					if (childClass === 'markers')
					{
						markersChildren = systemChildren[i].childNodes;
						for (j = 0; j < markersChildren.length; ++j)
						{
							if (markersChildren[j].nodeName !== '#text')
							{
								switch (markersChildren[j].getAttribute('class'))
								{
									case 'startMarker':
										system.startMarker = new Markers.StartMarker(markersChildren[j], viewBoxOriginY, viewBoxScale);
										break;
									case 'runningMarker':
										system.runningMarker = new Markers.RunningMarker(markersChildren[j], viewBoxOriginY, viewBoxScale);
										break;
									case 'endMarker':
										system.endMarker = new Markers.EndMarker(markersChildren[j], viewBoxOriginY, viewBoxScale);
										break;
								}
							}
						}
					}
					else if(childClass === 'outputStaff' || childClass === 'inputStaff')
					{
						staff = {};
						staff.voices = [];
						system.staves.push(staff);

						staffChildren = systemChildren[i].childNodes;
						for (j = 0; j < staffChildren.length; ++j)
						{
							if (staffChildren[j].nodeName !== '#text')
							{
								staffChildClass = staffChildren[j].getAttribute('class');

								if (staffChildClass === 'stafflines')
								{
									stafflineInfo = getStafflineInfo(staffChildren[j].childNodes);
									system.left = stafflineInfo.left;
									system.right = stafflineInfo.right;
									system.gap = getGap(system.gap, stafflineInfo.stafflineYs);

									staff.topLineY = stafflineInfo.stafflineYs[0];
									staff.bottomLineY = stafflineInfo.stafflineYs[stafflineInfo.stafflineYs.length - 1];
									staff.svgStafflines = stafflineInfo.svgStafflines; // top down
								}
								if(staffChildClass === 'outputVoice' || staffChildClass === 'inputVoice')
{
									voice = {};
									voiceChildren = staffChildren[j].childNodes;
									for(k = 0; k < voiceChildren.length; ++k)
									{
										voiceChild = voiceChildren[k];
										if(voiceChild.nodeName === "text")
										{
											staff.nameElem = voiceChild;
											break;
										}
									}
									staff.voices.push(voice);
								}
							}
						}
						setVoiceCentreYs(staff.topLineY, staff.bottomLineY, staff.voices);
					}
					else if(childClass.indexOf('barlines') !== -1)
					{
						barlinesChildren = systemChildren[i].childNodes;
						for(j = 0; j < barlinesChildren.length; ++j)
						{
							if(barlinesChildren[j].nodeName !== '#text')
							{
								system.firstBarlineX = parseFloat(barlinesChildren[j].getAttribute("x1"));
								system.firstBarlineX /= viewBoxScale;
								break;
							}
						}
					}
				}
			}

			system.topLineY = system.staves[0].topLineY;
			system.bottomLineY = system.staves[system.staves.length - 1].bottomLineY;
			if (system.gap === undefined)
			{
				system.gap = 4; // default value, when all staves have one line.
			}

			return system;
		}

		function getViewBoxScale(svgElem)
		{
			var width, viewBox, viewBoxStrings, viewBoxWidth, scale;

			width = parseFloat(svgElem.getAttribute('width'));
			viewBox = svgElem.getAttribute('viewBox');
			viewBoxStrings = viewBox.split(' ');
			viewBoxWidth = parseFloat(viewBoxStrings[2]);

			scale = viewBoxWidth / width;
			return scale;
		}

		/*************** end of getEmptyPagesAndSystems function definitions *****************************/

		// Initially there is no assistant (a non-assisted performance).
		// This value is changed when/if the assistant has been constructed.
		livePerformersTrackIndex = -1;

		resetContent();

		embeddedSvgPages = document.querySelectorAll(".svgPage");
		nPages = embeddedSvgPages.length;
		viewBoxOriginY = 0; // absolute coordinates
		for (i = 0; i < nPages; ++i)
		{
			sysNumber = 1;
			svgPage = svg.getSVGDocument(embeddedSvgPages[i]);

			svgElem = svgPage.childNodes[1];
			viewBoxScale = getViewBoxScale(svgElem); // a float >= 1 (currently, usually 8.0)
			svgChildren = svgElem.childNodes;
			for (j = 0; j < svgChildren.length; ++j)
			{
				if(svgChildren[j].nodeName !== '#text' && svgChildren[j].nodeName !== '#comment' && svgChildren[j].nodeName !== 'script')
				{
					childClass = svgChildren[j].getAttribute("class");
					if (childClass === "frame")
					{
						currentFrame = svgChildren[j];
						currentFrame.originY = viewBoxOriginY;
						svgFrames.push(currentFrame);
					}
					if (childClass === "system")
					{
						system = getEmptySystem(viewBoxOriginY, viewBoxScale, svgChildren[j]);
						systems.push(system); // systems is global inside this namespace
					}
				}
			}
			pageHeight = parseInt(svgElem.getAttribute('height'), 10);
			viewBoxOriginY += pageHeight;
		}
	},

	setEndMarkerClick = function (e)
	{
		svgPageClicked(e, 'settingEnd');
	},

	setStartMarkerClick = function (e)
	{
		svgPageClicked(e, 'settingStart');
	},

	sendStartMarkerToStart = function ()
	{
		startMarker = systems[0].startMarker;
		hideStartMarkersExcept(startMarker);
		startMarker.moveTo(systems[0].staves[0].voices[0].timeObjects[0]);
	},

	sendEndMarkerToEnd = function ()
	{
		var lastTimeObjects = systems[systems.length - 1].staves[0].voices[0].timeObjects;

		endMarker = systems[systems.length - 1].endMarker;
		hideEndMarkersExcept(endMarker);
		endMarker.moveTo(lastTimeObjects[lastTimeObjects.length - 1]);
	},

	startMarkerMsPosition = function ()
	{
		return startMarker.msPosition();
	},

	endMarkerMsPosition = function ()
	{
		return endMarker.msPosition();
	},

	// Called when the start button is clicked in the top options panel,
	// and when setOptions button is clicked at the top of the score.
	// If the startMarker is not fully visible in the svgPagesDiv, move
	// it to the top of the div.
	moveStartMarkerToTop = function (svgPagesDiv)
	{
		var height = Math.round(parseFloat(svgPagesDiv.style.height)),
		scrollTop = svgPagesDiv.scrollTop, startMarkerYCoordinates;

		startMarkerYCoordinates = startMarker.getYCoordinates();

		if ((startMarkerYCoordinates.top < scrollTop) || (startMarkerYCoordinates.bottom > (scrollTop + height)))
		{
			if (startMarker.systemIndex() === 0)
			{
				svgPagesDiv.scrollTop = 0;
			}
			else
			{
				svgPagesDiv.scrollTop = startMarkerYCoordinates.top - 10;
			}
		}
	},

	// Advances the running marker to the following timeObject (in any channel).
	// If msPosition is >= the endMsPosition of the current system, and the 
	// current system is not the last, the running marker is moved to the following system.
	advanceRunningMarker = function (msPosition)
	{
		if (msPosition >= systems[runningMarker.systemIndex()].endMsPosition)
		{
			// Move runningMarker to the beginning of the next system.
			runningMarker.setVisible(false);
			if (runningMarker.systemIndex() < (systems.length - 1))
			{
				runningMarker = systems[runningMarker.systemIndex() + 1].runningMarker;
				runningMarker.moveToStartOfSystem();
				runningMarker.setVisible(true);
			}
			// callback for auto scroll
			runningMarkerHeightChanged(runningMarker.getYCoordinates());
		}
		else
		{
			while (msPosition >= runningMarker.nextMsPosition())
			{
				// this function can assume that the runningMarker's currentPosition can simply be incremented
				runningMarker.incrementPosition();
			}
		}
	},

	// Returns a new Sequence. Creates sequence.tracks, which is an array containing one track per channel (ordered by channel).
	// Each track is an array of midiObjects ordered in time (see ap/Track.js ap/midiChord.js, ap/midiRest.js).
	// If this is a live performance (as opposed to a score playback), the livePerformersSilentTrack
	// is also filled with rests and silent chords. Then, when score.redrawDisplay() is called (on toggling
	// a trackContol), the live performer's track is set to livePerformersSoundingTrack or livePerformersSilentTrack
	// as necessary.
	getSequence = function(svg, isAssistedPerformance, livePerfTrackIndex, globalSpeed)
	{
		// systems->staves->voices->timeObjects
		var
		sequence,
		trackIndex, track, tracks,
		timeObjectIndex, nTimeObjects, timeObject, chordIsSilent,
		voiceIndex, nVoices, voice,
		staffIndex, nStaves, staff,
		sysIndex, nSystems = systems.length, system,
		channels = [], channel, chordDef, midiChord, midiRest;

		// Gets the timeObjects. 
		// speed is a floating point number, greater than zero.
		// msDurations stored in the score are divided by speed.
		// Rounding errors are corrected, so that all voices in
		// a system continue to have the same msDuration.
		function getTimeObjects(svg, speed)
		{
			var embeddedSvgPages, nPages,
				i, j,
				systemIndex, sysNumber, svgPage, svgElem, viewBoxScale2, svgChildren, systemID,
				childClass,
				lastSystemTimeObjects, finalBarlineMsPosition;

			function getViewBoxScale(svgElem)
			{
				var width, viewBox, viewBoxStrings, viewBoxWidth, scale;

				width = parseFloat(svgElem.getAttribute('width'));
				viewBox = svgElem.getAttribute('viewBox');
				viewBoxStrings = viewBox.split(' ');
				viewBoxWidth = parseFloat(viewBoxStrings[2]);

				scale = viewBoxWidth / width;
				return scale;
			}

			// Loads voice.timeObjects for each voice in the system.
			// A timeObject is either an outputChord or a rest.
			// Both outputChord and rest timeObjects are given alignmentX and msDuration attributes, but
			// as yet no msPosition.
			// msPosition attributes are added to these timeObjects when all the systems have been read.
			function getSystemVoiceTimeObjects(system, viewBoxScale1, systemNode, speed)
			{
				var i, j, systemChildren, childClass,
					staff, staffChildren, staffChildClass,
					voice,
					staffIndex = 0,
					voiceIndex = 0;

				// A timeObject is either an outputChord or a rest.
				// Both outputChords and rests have alignmentX and msDuration fields.
				// Later in this program (as soon as all systems have been read), the msPosition
				// of all timeObjects will appended to them.
				function getVoiceTimeObjects(noteObjects, speed)
				{
					var timeObjects = [], typeString,
						timeObject, i, j, k, length, noteObject, chordChildren, midiChildren;

					// timeObjects is an array of timeObject.
					// speed is a floating point number, greater than zero.
					// returns the new length of the voice in integer milliseconds
					function changeSpeed(timeObjects, speed)
					{
						// adjust the top level msDuration of each timeObject
						function adjustTotalDurations(timeObjects, speed)
						{
							var i, nTimeObjects = timeObjects.length, msFPDuration,
							msFPPositions = [];

							msFPPositions.push(0);
							for(i = 0; i < nTimeObjects; ++i)
							{
								msFPDuration = timeObjects[i].msDuration / speed;
								msFPPositions.push(msFPDuration + msFPPositions[i]);
							}

							for(i = 0; i < nTimeObjects; ++i)
							{
								timeObjects[i].msDuration = Math.round(msFPPositions[i + 1] - msFPPositions[i]);
							}
						}

						// adjust the msDuration of each object in each timeObject.chordDef.basicChordsArray,
						// correcting rounding errors to ensure that the sum of the durations of the
						// basicChords is exactly equal to the containing timeObject.msDuration (which has
						// already been adjusted).
						function adjustBasicChordDurations(timeObjects, speed)
						{
							var i, nTimeObjects = timeObjects.length;

							function adjustDurations(basicChords, speed, chordMsDuration)
							{
								var i, nBasicChords = basicChords.length, msFPDuration,
								msFPPositions = [], totalBasicMsDurations = 0,
								excessDuration;

								function correctRoundingError(basicChords, excessDuration)
								{
									while(excessDuration !== 0)
									{
										for(i = basicChords.length - 1; i >= 0; --i)
										{
											if(excessDuration > 0)
											{
												if(basicChords[i].msDuration > 1)
												{
													basicChords[i].msDuration -= 1;
													excessDuration -= 1;
												}
											}
											else if(excessDuration < 0)
											{
												basicChords[nBasicChords - 1].msDuration += 1;
												excessDuration += 1;
											}
											else
											{
												break;
											}
										}
									}
								}

								// get the speed changed (floating point) basic chord positions re start of chord.
								msFPPositions.push(0);
								for(i = 0; i < nBasicChords; ++i)
								{
									msFPDuration = basicChords[i].msDuration / speed;
									msFPPositions.push(msFPDuration + msFPPositions[i]);
								}

								// get the (integer) msDuration of each basic chord (possibly with rounding errors)
								// nMsPositions = nBasicChords + 1;
								for(i = 0; i < nBasicChords; ++i)
								{
									basicChords[i].msDuration = Math.round(msFPPositions[i + 1] - msFPPositions[i]);
									totalBasicMsDurations += basicChords[i].msDuration;
								}

								// if there is a rounding error, correct it.
								excessDuration = totalBasicMsDurations - chordMsDuration;
								if(excessDuration !== 0)
								{
									correctRoundingError(basicChords, excessDuration);
								}	
							}

							for(i = 0; i < nTimeObjects; ++i)
							{
								if(timeObjects[i].chordDef !== undefined)
								{
									adjustDurations(timeObjects[i].chordDef.basicChordsArray, speed, timeObjects[i].msDuration);
								}
							}
						}

						adjustTotalDurations(timeObjects, speed);
						adjustBasicChordDurations(timeObjects, speed);
					}

					function getMsDuration(chordDef)
					{
						var i,
							msDuration = 0,
							basicChordsArray = chordDef.basicChordsArray;

						for(i = 0; i < basicChordsArray.length; ++i)
						{
							msDuration += basicChordsArray[i].msDuration;
						}

						return msDuration;
					}

					length = noteObjects.length;
					for(i = 0; i < length; ++i)
					{
						noteObject = noteObjects[i];
						if(noteObject.nodeName === 'g')
						{
							typeString = noteObject.getAttribute('class');
							if(typeString === 'outputChord')
							{
								timeObject = {};
								timeObject.alignmentX = parseFloat(noteObject.getAttribute('score:alignmentX')) / viewBoxScale1;
								chordChildren = noteObject.childNodes;
								for(j = 0; j < chordChildren.length; ++j)
								{
									if(chordChildren[j].nodeName === 'score:midiChord')
									{
										midiChildren = chordChildren[j].childNodes;
										for(k = 0; k < midiChildren.length; ++k)
										{
											if(midiChildren[k].nodeName === 'score:basicChords')
											{
												timeObject.chordDef = new ChordDef(chordChildren[j]);
												break;
											}
										}
										break;
									}
								}
								timeObject.msDuration = getMsDuration(timeObject.chordDef);
								timeObjects.push(timeObject);
							}
							else if(typeString === 'rest')
							{
								timeObject = {};
								timeObject.alignmentX = parseFloat(noteObject.getAttribute('score:alignmentX') / viewBoxScale1);
								timeObject.msDuration = parseFloat(noteObject.getAttribute('score:msDuration'));
								timeObjects.push(timeObject);
							}
						}
					}

					if(speed !== 1)
					{
						changeSpeed(timeObjects, speed);
					}

					return timeObjects;
				}

				systemChildren = systemNode.childNodes;
				for(i = 0; i < systemChildren.length; ++i)
				{
					if(systemChildren[i].nodeName !== '#text')
					{
						childClass = systemChildren[i].getAttribute("class");
						if(childClass === 'outputStaff')
						{
							staff = system.staves[staffIndex++];
							staffChildren = systemChildren[i].childNodes;
							for(j = 0; j < staffChildren.length; ++j)
							{
								if(staffChildren[j].nodeName !== '#text')
								{
									staffChildClass = staffChildren[j].getAttribute('class');
									if(staffChildClass === 'outputVoice')
									{
										voice = staff.voices[voiceIndex++];
										voice.timeObjects = getVoiceTimeObjects(staffChildren[j].childNodes, speed);
									}
								}
							}
							voiceIndex = 0;
						}
					}
				}
			}

			// Sets the msPosition of each timeObject (rests and outputChords) in the voice.timeObjects arrays
			// Returns the msPosition of the final barline in the score.
			function setMsPositions(systems)
			{
				var nStaves, staffIndex, nVoices, voiceIndex, nSystems, systemIndex, msPosition,
					timeObjects, nTimeObjects, tIndex, finalMsPosition;

				nSystems = systems.length;
				nStaves = systems[0].staves.length;
				msPosition = 0;
				for(staffIndex = 0; staffIndex < nStaves; ++staffIndex)
				{
					nVoices = systems[0].staves[staffIndex].voices.length;
					for(voiceIndex = 0; voiceIndex < nVoices; ++voiceIndex)
					{
						for(systemIndex = 0; systemIndex < nSystems; ++systemIndex)
						{
							timeObjects = systems[systemIndex].staves[staffIndex].voices[voiceIndex].timeObjects;
							nTimeObjects = timeObjects.length;
							for(tIndex = 0; tIndex < nTimeObjects; ++tIndex)
							{
								timeObjects[tIndex].msPosition = msPosition;
								msPosition += timeObjects[tIndex].msDuration;
							}
						}
						finalMsPosition = msPosition;
						msPosition = 0;
					}
				}
				return finalMsPosition;
			}

			// Sets system.startMsPosition and system.endMsPosition. These values are needed for selecting
			// runningMarkers.
			// Except in the final system, system.endMsPosition is equal to the startMsPosition of
			// the following system. The final system's endMsPosition is set to the finalBarlineMsPosition
			// argument.
			// To be precise: system.StartMsPosition is the earliest msPosition of any timeObject
			// in any voice.timeObjects. This allows for the "tied notes" which Moritz now supports...
			//
			// This function also adds a finalBarline (having msDuration=0, msPosition and alignmentX)
			// to the end of each voice.timeObjects array. These values are used by endMarkers.
			function setSystemMsPositionsAndAddFinalBarlineToEachVoice(systems, finalBarlineMsPosition)
			{
				var nSystems = systems.length,
					nSystemsMinusOne = systems.length - 1,
					nStaves = systems[0].staves.length,
					nVoices,
					systemIndex, staffIndex, voiceIndex,
					system, voice, finalBarline;

				function smallestMsPosition(system)
				{
					var staffIndex, voiceIndex,
						nStaves = system.staves.length, nVoices,
						minMsPosition = Infinity,
						voice, voiceMsPosition;

					for(staffIndex = 0; staffIndex < nStaves; ++staffIndex)
					{
						nVoices = system.staves[staffIndex].voices.length;
						for(voiceIndex = 0; voiceIndex < nVoices; ++voiceIndex)
						{
							voice = system.staves[staffIndex].voices[voiceIndex];
							voiceMsPosition = voice.timeObjects[0].msPosition;
							minMsPosition = (minMsPosition < voiceMsPosition) ? minMsPosition : voiceMsPosition;
						}
					}
					return minMsPosition;
				}

				systems[0].startMsPosition = 0;
				if(nSystems > 1) // set all but last system
				{
					for(systemIndex = 0; systemIndex < nSystemsMinusOne; ++systemIndex)
					{
						system = systems[systemIndex];
						system.endMsPosition = smallestMsPosition(systems[systemIndex + 1]);
						systems[systemIndex + 1].startMsPosition = system.endMsPosition;
						for(staffIndex = 0; staffIndex < nStaves; ++staffIndex)
						{
							nVoices = system.staves[staffIndex].voices.length;
							for(voiceIndex = 0; voiceIndex < nVoices; ++voiceIndex)
							{
								voice = system.staves[staffIndex].voices[voiceIndex];
								finalBarline = {};
								finalBarline.msDuration = 0;
								finalBarline.msPosition = systems[systemIndex + 1].startMsPosition;
								finalBarline.alignmentX = system.right;
								voice.timeObjects.push(finalBarline);
							}
						}
					}
				}

				// set final system's final barline
				system = systems[systems.length - 1];
				system.endMsPosition = finalBarlineMsPosition;
				for(staffIndex = 0; staffIndex < nStaves; ++staffIndex)
				{
					nVoices = system.staves[staffIndex].voices.length;
					for(voiceIndex = 0; voiceIndex < nVoices; ++voiceIndex)
					{
						voice = system.staves[staffIndex].voices[voiceIndex];
						finalBarline = {};
						finalBarline.msDuration = 0;
						finalBarline.msPosition = finalBarlineMsPosition;
						finalBarline.alignmentX = system.right;
						voice.timeObjects.push(finalBarline);
					}
				}
			}

			function setSystemMarkerParameters(systems)
			{
				var i, nSystems = systems.length, system;
				for(i = 0; i < nSystems; ++i)
				{
					system = systems[i];
					system.startMarker.setParameters(system, i);
					system.startMarker.setVisible(false);
					system.runningMarker.setParameters(system, i);
					system.runningMarker.setVisible(false);
					system.endMarker.setParameters(system);
					system.endMarker.setVisible(false);
				}

				startMarker = systems[0].startMarker;
				startMarker.setVisible(true);

				moveRunningMarkerToStartMarker(); // is only visible when playing...

				endMarker = systems[systems.length - 1].endMarker;
				endMarker.moveTo(finalBarlineInScore);
				endMarker.setVisible(true);
			}

			/*************** end of getTimeObjects function definitions *****************************/

			embeddedSvgPages = document.querySelectorAll(".svgPage");
			nPages = embeddedSvgPages.length;
			systemIndex = 0;
			for(i = 0; i < nPages; ++i)
			{
				sysNumber = 1;
				svgPage = svg.getSVGDocument(embeddedSvgPages[i]);

				svgElem = svgPage.childNodes[1];
				viewBoxScale2 = getViewBoxScale(svgElem); // a float >= 1 (currently, usually 8.0)
				svgChildren = svgElem.childNodes;
				for(j = 0; j < svgChildren.length; ++j)
				{
					if(svgChildren[j].nodeName !== '#text' && svgChildren[j].nodeName !== '#comment' && svgChildren[j].nodeName !== 'script')
					{
						childClass = svgChildren[j].getAttribute("class");
						if(childClass === "system")
						{
							if(systems[systemIndex].msDuration !== undefined)
							{
								delete systems[systemIndex].msDuration; // is reset in the following function
							}
							getSystemVoiceTimeObjects(systems[systemIndex], viewBoxScale2, svgChildren[j], speed);
							systemIndex++;
						}
					}
				}
			}

			finalBarlineMsPosition = setMsPositions(systems);
			setSystemMsPositionsAndAddFinalBarlineToEachVoice(systems, finalBarlineMsPosition);

			lastSystemTimeObjects = systems[systems.length - 1].staves[0].voices[0].timeObjects;
			finalBarlineInScore = lastSystemTimeObjects[lastSystemTimeObjects.length - 1]; // 'global' object

			setSystemMarkerParameters(systems);
		}

		function numberOfVoices()
		{
			var nVoices = 0,
			staffIndex, nStaves = systems[0].staves.length;

			for(staffIndex = 0; staffIndex < nStaves; ++staffIndex)
			{
				nVoices += systems[0].staves[staffIndex].voices.length;
			}
			return nVoices;
		}

		// inserts each midiChord's finalChordOffMoment.messages in the first moment in the following midiObject.
		function transferFinalChordOffMoments(tracks)
		{
			var trackIndex, midiObjectIndex, finalChordOffMessages, nextObjectMessages, i;

			for(trackIndex = 0; trackIndex < tracks.length; ++trackIndex)
			{
				track = tracks[trackIndex];
				if(track.midiObjects.length > 1)
				{
					for(midiObjectIndex = 1; midiObjectIndex < track.midiObjects.length; ++midiObjectIndex)
					{
						if(track.midiObjects[midiObjectIndex - 1] instanceof MidiChord)
						{
							if(track.midiObjects[midiObjectIndex - 1].finalChordOffMoment === undefined)
							{
								throw "Error: finalChordOffMoment must be defined (but it can be empty).";
							}
							finalChordOffMessages = track.midiObjects[midiObjectIndex - 1].finalChordOffMoment.messages;
							nextObjectMessages = track.midiObjects[midiObjectIndex].moments[0].messages;
							for(i = 0; i < finalChordOffMessages.length; ++i)
							{
								nextObjectMessages.splice(0, 0, finalChordOffMessages[i]);
							}
						}
					}
				}
			}
		}

		getTimeObjects(svg, globalSpeed);

		// sets sequence to contain numberOfVoices() empty tracks.
		sequence = new Sequence(numberOfVoices());
		tracks = sequence.tracks;
		for(trackIndex = 0; trackIndex < tracks.length; ++trackIndex)
		{
			channels.push(new Number(trackIndex)); // channels are Number objects (to which bank and patch attributes can be added).
		}

		if(isAssistedPerformance === true)
		{
			livePerformersSilentTrack = new Track();
			livePerformersTrackIndex = livePerfTrackIndex;
		}
		else
		{
			livePerformersTrackIndex = -1;
		}

		nStaves = systems[0].staves.length;

		for(sysIndex = 0; sysIndex < nSystems; ++sysIndex)
		{
			system = systems[sysIndex];
			trackIndex = 0;
			for(staffIndex = 0; staffIndex < nStaves; ++staffIndex)
			{
				staff = system.staves[staffIndex];
				nVoices = staff.voices.length;
				for(voiceIndex = 0; voiceIndex < nVoices; ++voiceIndex)
				{
					voice = staff.voices[voiceIndex];
					nTimeObjects = voice.timeObjects.length;
					track = tracks[trackIndex];
					channel = channels[trackIndex]; // a channel is a Number object (to which bank and patch attributes can be added).
					for(timeObjectIndex = 0; timeObjectIndex < nTimeObjects; ++timeObjectIndex)
					{
						timeObject = voice.timeObjects[timeObjectIndex];

						if(timeObject.chordDef === undefined)
						{
							if(timeObjectIndex < (nTimeObjects - 1))
							{
								// A real rest. All barlines on the right ends of staves are ignored.
								midiRest = new MidiRest(timeObject);
								track.midiObjects.push(midiRest);
								if(isAssistedPerformance === true && trackIndex === livePerformersTrackIndex)
								{
									midiRest = new MidiRest(timeObject);
									livePerformersSilentTrack.midiObjects.push(midiRest);
								}
								//console.log("midiRest added at sysIndex=%i, staffIndex=%i, timeObjectIndex=%i", sysIndex, staffIndex, timeObjectIndex);
							}
						}
						else
						{
							chordDef = timeObject.chordDef;
							chordIsSilent = false;
							midiChord = new MidiChord(channel, chordDef, timeObject, chordIsSilent);
							track.midiObjects.push(midiChord);
							//console.log("midiChord added at sysIndex=%i, staffIndex=%i, timeObjectIndex=%i", sysIndex, staffIndex, timeObjectIndex);
							if(isAssistedPerformance === true && trackIndex === livePerformersTrackIndex)
							{
								chordIsSilent = true;
								midiChord = new MidiChord(channel, chordDef, timeObject, chordIsSilent);
								livePerformersSilentTrack.midiObjects.push(midiChord);
							}
						}
					}
					if(isAssistedPerformance === true && trackIndex === livePerformersTrackIndex)
					{
						livePerformersSoundingTrack = track;
					}
					++trackIndex;
				}
			}
		}

		transferFinalChordOffMoments(tracks);

		return sequence;
	},

	// an empty score
	Score = function (callback)
	{
		if (!(this instanceof Score))
		{
			return new Score(callback);
		}

		svgFrames = [];
		systems = [];

		runningMarkerHeightChanged = callback;

		// Sends a noteOff to all notes on all channels on the midi output device.
		this.allNotesOff = allNotesOff;

		// functions called when setting the start or end marker
		this.setStartMarkerClick = setStartMarkerClick;
		this.setEndMarkerClick = setEndMarkerClick;

		// functions called when clicking the sendStartMarkerToStart of senEndMarkerToEnd buttons
		this.sendStartMarkerToStart = sendStartMarkerToStart;
		this.sendEndMarkerToEnd = sendEndMarkerToEnd;

		// functions which return the current start and end times.
		this.startMarkerMsPosition = startMarkerMsPosition;
		this.endMarkerMsPosition = endMarkerMsPosition;

		// Called when the start button is clicked in the top options panel,
		// and when setOptions button is clicked at the top of the score.
		// If the startMarker is not fully visible in the svgPagesDiv, move
		// it to the top of the div.
		this.moveStartMarkerToTop = moveStartMarkerToTop;

		// Recalculates the timeObject lists for the runningMarkers (1 marker per system),
		// using trackIsOn (tracksControl.trackIsOn) to take into account which tracks are actually performing.
		// When the score is first read, all tracks perform by default.
		this.setRunningMarkers = setRunningMarkers;
		// Advances the running marker to the following timeObject (in any channel)
		// if the msPosition argument is >= that object's msPosition. Otherwise does nothing.
		this.advanceRunningMarker = advanceRunningMarker;
		this.hideRunningMarkers = hideRunningMarkers;
		this.moveRunningMarkerToStartMarker = moveRunningMarkerToStartMarker;

		// The frames in the GUI
		this.svgFrames = svgFrames;

		this.getEmptyPagesAndSystems = getEmptyPagesAndSystems;

		// returns a new sequence
		this.getSequence = getSequence;

		// Loads the trackIsOn callback.
		this.getTrackIsOnCallback = getTrackIsOnCallback;

		// The svgTracksControl controls the display, and should be the only module to
		// call this function [score.refreshDisplay(isAssistedPerformance, livePerformersTrackIndex)]
		this.refreshDisplay = refreshDisplay;
	},

	publicAPI =
	{
		// empty score constructor (access to GUI functions)
		Score: Score

	};
// end var

return publicAPI;

} (document));
