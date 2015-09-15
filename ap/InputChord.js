/*
 *  copyright 2012 James Ingram
 *  http://james-ingram-act-two.de/
 *
 *  Code licensed under MIT
 *  https://github.com/notator/assistant-performer/blob/master/License.md
 *
 *  ap/InputChord.js
 *  Public interface:
 *      InputChord(timeObject, outputTracks) // InputChord constructor 
 */

/*jslint bitwise: false, nomen: true, plusplus: true, white: true */
/*global _AP: false,  window: false,  document: false, performance: false, console: false, alert: false, XMLHttpRequest: false */

_AP.namespace('_AP.inputChord');

_AP.inputChord = (function()
{
    "use strict";
    // begin var
    var

    // public InputChord constructor
    // An InputChord contains all the information required for playing an (ornamented) chord.
    InputChord = function(timeObject, outputTracks)
    {
    	var inputNotes;

    	// getInputNotes() Arguments:
    	// Each object in the inputNoteDefs argument contains the following fields
    	//		.notatedKey (a number. The MIDI index of the notated key.)
    	//		.trkOptions -- undefined or an TrkOptions object
    	//		.noteOn -- undefined (or see below)
    	//      .noteOff -- undefined (or see below)
    	//
    	//		.noteOn and .noteOff can have the following fields:
    	//			.seqDef -- undefined or an array of trkRef, which may have a trkOptions attribute.
    	//				Each trkRef has the following fields:
    	//					.trkOptions -- undefined or an TrkOptions object
    	//					.midiChannel (compulsory int >= 0. The midiChannel of the voice containing the referenced Trk. )
    	//					.msPosition (compulsory int >= 0. The msPositionInScore of the referenced Trk.)
    	//					.length (compulsory int >= 0. The number of MidiChords and Rests the referenced Trk.)
    	//			.pressures -- undefined or an array of midiChannel, which may have a trkOptions attribute.
    	//			.pitchWheels -- undefined or an array of midiChannel, which may have a trkOptions attribute.
    	//			.modWheels -- undefined or an array of midiChannel, which may have a trkOptions attribute.
    	//			.trkOffs -- undefined or an array of trkOff, each of which has a .midiChannel and a .msPosition attribute
		//------------------------------------------------------------------------------
    	// getInputNotes() Returns:
    	// An array of inputNote objects, the fields of which have been copied from the corresponding inputNoteDefs (see above)
    	// but with midiChannel values converted to trackIndices:
    	function getInputNotes(inputNoteDefs, outputTracks, chordMsPositionInScore)
    	{
    		var i, nInputNoteDefs = inputNoteDefs.length, inputNoteDef,
				inputNote, inputNotes = [];

    		function getNoteOnOrOff(noteInfo, outputTracks, chordMsPositionInScore)
    		{
    			var noteOnOrOff = {};

    			function getSeq(onSeq, outputTracks, chordMsPositionInScore)
    			{
    				var trk, trks = [], i, trkOn, nTrkOns = onSeq.length, trackMidiObjects;

    				function getMidiObjectIndex(trkMsPosition, midiObjects)
    				{
    					var found = false, midiObjectIndex;

    					for(midiObjectIndex = 0; midiObjectIndex < midiObjects.length; ++midiObjectIndex)
    					{
    						if(midiObjects[midiObjectIndex].msPositionInScore === trkMsPosition)
    						{
    							found = true;
    							break;
    						}
    					}
    					if(found === false)
    					{
    						throw "InputChord.js: Can't find the first midiObject in the trk!";
    					}
    					return midiObjectIndex;
    				}

    				function getMidiObjects(startIndex, length, trackMidiObjects)
    				{
    					var midiObjects = [], i, midiObjIndex = startIndex;

    					for(i=0; i < length; ++i)
    					{
    						midiObjects.push(trackMidiObjects[midiObjIndex++]);
    					}
    					return midiObjects;
    				}

    				for(i = 0; i < nTrkOns; ++i)
    				{
    					trkOn = onSeq[i];
    					trk = {};
						
    					if(trkOn.trkOptions !== undefined)
    					{
    						trk.trkOptions = trkOn.trkOptions;
    					}
    					trk.trackIndex = outputTracks.trackIndexPerMidiChannel[trkOn.midiChannel];
    					trackMidiObjects = outputTracks[trk.trackIndex].midiObjects;
    					trk.midiObjectIndex = getMidiObjectIndex(trkOn.msPosition, trackMidiObjects);
    					trk.msOffset = trackMidiObjects[trk.midiObjectIndex].msPositionInScore - chordMsPositionInScore;
    					trk.midiObjects = getMidiObjects(trk.midiObjectIndex, trkOn.nMidiObjects, trackMidiObjects);

    					trks.push(trk);
    				}

    				if(onSeq.trkOptions !== undefined)
    				{
    					trks.trkOptions = onSeq.trkOptions;
    				}

    				return trks;
    			}

    			function getTrackOpts(channelOpts, trackIndexPerMidiChannel)
    			{
    				var i, nChannelOpts = channelOpts.length, channelOpt, trackOpt, trackOpts = [];

    				if(channelOpts.trkOptions !== undefined)
    				{
    					trackOpts.trkOptions = channelOpts.trkOptions;
    				}

    				for(i = 0; i < nChannelOpts; ++i)
    				{
    					trackOpt = {};
    					channelOpt = channelOpts[i];
    					if(channelOpt.trkOptions !== undefined)
    					{
    						trackOpt.trkOptions = channelOpt.trkOptions;
    					}
    					trackOpt.trackIndex = trackIndexPerMidiChannel[channelOpt.midiChannel];

    					trackOpts.push(trackOpt);
    				}

    				return trackOpts;
    			}

    			function getOffTrks(offTrks, trackIndexPerMidiChannel)
    			{
    				var i, nTrkOffs = offTrks.length, tOff, tOffs = [];

    				for(i=0; i < nTrkOffs; ++i)
    				{
    					tOff = {};
    					tOff.trackIndex = trackIndexPerMidiChannel[offTrks[i].midiChannel];
    					tOff.msPosition = offTrks[i].msPosition;
    					tOffs.push(tOff);						
    				}
    				return tOffs;
    			}

    			if(noteInfo.seqDef !== undefined)
    			{
    				noteOnOrOff.seqDef = getSeq(noteInfo.seqDef, outputTracks, chordMsPositionInScore);
    			}

    			if(noteInfo.pressures !== undefined)
    			{
    				noteOnOrOff.pressures = getTrackOpts(noteInfo.pressures, outputTracks.trackIndexPerMidiChannel);
    			}
    			if(noteInfo.pitchWheels !== undefined)
    			{
    				noteOnOrOff.pitchWheels = getTrackOpts(noteInfo.pitchWheels, outputTracks.trackIndexPerMidiChannel);
    			}
    			if(noteInfo.modWheels !== undefined)
    			{
    				noteOnOrOff.modWheels = getTrackOpts(noteInfo.modWheels, outputTracks.trackIndexPerMidiChannel);
    			}

    			if(noteInfo.trkOffs !== undefined)
    			{
    				noteOnOrOff.trkOffs = getOffTrks(noteInfo.trkOffs, outputTracks.trackIndexPerMidiChannel);
    			}

    			return noteOnOrOff;
    		}

    		for(i = 0; i < nInputNoteDefs; ++i)
    		{
    			inputNoteDef = inputNoteDefs[i];
    			inputNote = {};
    			inputNote.notatedKey = inputNoteDef.notatedKey;
    			if(inputNoteDef.trkOptions !== undefined)
    			{
    				inputNote.trkOptions = inputNoteDef.trkOptions;
    			}
    			if(inputNoteDef.noteOn !== undefined)
    			{
    				inputNote.noteOn = getNoteOnOrOff(inputNoteDef.noteOn, outputTracks, chordMsPositionInScore);
    			}
    			if(inputNoteDef.noteOff !== undefined)
    			{
    				inputNote.noteOff = getNoteOnOrOff(inputNoteDef.noteOff, outputTracks, chordMsPositionInScore);
    			}
    			inputNotes.push(inputNote);
    		}

    		return inputNotes;
    	}

        if(!(this instanceof InputChord))
        {
        	return new InputChord(timeObject, outputTracks);
        }

        // The timeObject takes the global speed option into account.
        Object.defineProperty(this, "msPositionInScore", { value: timeObject.msPosition, writable: false });
        Object.defineProperty(this, "msDurationInScore", { value: timeObject.msDuration, writable: false });
        if(timeObject.inputChordDef.trkOptions !== undefined)
        {
        	Object.defineProperty(this, "trkOptions", { value: timeObject.inputChordDef.trkOptions, writable: true });
        }

        inputNotes = getInputNotes(timeObject.inputChordDef.inputNotes, outputTracks, timeObject.msPosition);

        Object.defineProperty(this, "inputNotes", {value: inputNotes, writable: false});

        return this;
    },

    publicInputChordAPI =
    {
        // public InputChord constructor
    	// A InputChord contains a private array of inputNotes.
    	// Each inputNote contains an array of parallel MidiObject arrays (trks). 
        InputChord: InputChord
    };
    // end var

    // Seq.prototype functions come here...

    return publicInputChordAPI;
}());
