﻿/*
 *  copyright 2012 James Ingram
 *  http://james-ingram-act-two.de/
 *
 *  Code licensed under MIT
 *  https://github.com/notator/assistant-performer/blob/master/License.md
 *
 *  ap/InputChordDef.js
 *  Public interface contains:
 *     InputChordDef(inputNotesNode) // Chord definition constructor. Reads the XML in the inputNotesNode. 
 *  
 */

/*jslint bitwise: false, nomen: false, plusplus: true, white: true */
/*global _AP: false,  window: false,  document: false, performance: false, console: false, alert: false, XMLHttpRequest: false */

_AP.namespace('_AP.inputChordDef');

_AP.inputChordDef = (function ()
{
    "use strict";
	var
	InputControls = _AP.inputControls.InputControls,

    // InputChordDef constructor
    // The inputChordDef contains the inputChordDef information from the XML in a form that is easier to program with.
    // The InputChordDef has the following fields:
	//		inputChordDef.inputControls -- undefined or an InputControls object
    //		inputChordDef.inputNotes[] -- see below
    //
    // Each inputNote in the inputChordDef.inputNotes[] has the following fields:
	//		inputNote.notatedKey (a number. The MIDI index of the notated key.)
	//		inputNote.inputControls -- undefined or an InputControls object
    //		inputNote.noteOn -- undefined or see below
	//      inputNote.pressures -- undefined or an array of pressure objects.
	//      inputNote.noteOff -- undefined or see below
	//
	// if defined, inputNote.noteOn has the following fields:
	//      inputNote.noteOn.trkOns -- undefined or an array of trkOn with a (possibly undefined) InputControls field.
	//		inputNote.noteOn.trkOffs -- undefined or an array of trkOff with a (possibly undefined) InputControls field.
	//
	// if defined, inputNote.pressures contains an array of pressure objects with a (possibly undefined) InputControls field.
	//      Each pressure object has a midiChannel and a (possibly undefined) InputControls field. 
	//
	// if defined, inputNote.noteOff has the same fields as inputNote.noteOn:
	//      inputNote.noteOff.trkOns -- undefined or an array of trkOn with a (possibly undefined) InputControls field.
	//		inputNote.noteOff.trkOffs -- undefined or an array of trkOff with a (possibly undefined) InputControls field.
	//
	// if defined, trkOn has the following fields:
	//		trkOn.inputControls -- undefined or an InputControls object
	//		trkOn.midiChannel (compulsory int >= 0. The midiChannel of the voice containing the referenced Trk. )
	//		trkOn.msPosition (compulsory int >= 0. The msPositionInScore of the referenced Trk)
	//		trkOn.nMidiObjects (compulsory int >= 0. The number of MidiChords and Rests in the referenced Trk.)
	//
	// if defined, trkOff has the following fields:
	//		trkOn.inputControls -- undefined or an InputControls object
	//		trkOn.midiChannel (compulsory int >= 0. The midiChannel of the voice containing the referenced Trk. )
	//		trkOn.msPosition (compulsory int >= 0. The msPositionInScore of the referenced Trk)
	//
	// An inputChordDef.inputControls sets the current values in the midi input channel until further notice.
	// InputControls at lower levels temporarily override the inputControls at higher levels.
	InputChordDef = function (inputNotesNode)
	{
		var chordDef;
		
		function getChordDef(inputNotesNode)
		{
			var i, childNodes = inputNotesNode.childNodes,
				returnValue = {};

			function getInputNote(inputNoteNode)
			{
				var attr,
					inputNote = {},
					attrs = inputNoteNode.attributes,
					nAttributes = attrs.length,
					childNodes = inputNoteNode.childNodes,
					i;

				// returns an object that can have trkOns and trkOffs attributes
				function getNoteOnOrNoteOff(noteOnOrNoteOffNode)
				{
					var i, childNodes = noteOnOrNoteOffNode.childNodes, nChildNodes = childNodes.length,
					returnObject = {};

					// returns an array of trkOn, possibly having an inputControls attribute 
					function getTrkOns(trkOnsNode)
					{
						var i, childNodes, returnArray = [];

						function getTrkOn(trkOnNode)
						{
							var i, attr,
							trkOn = {},
							attrLen = trkOnNode.attributes.length,
							childNodes = trkOnNode.childNodes;

							for(i = 0; i < attrLen; ++i)
							{
								attr = trkOnNode.attributes[i];
								switch(attr.name)
								{
									case "midiChannel":
										trkOn.midiChannel = parseInt(attr.value, 10);
										break;
									case "msPosition":
										trkOn.msPosition = parseInt(attr.value, 10);
										break;
									case "nMidiObjects":
										trkOn.nMidiObjects = parseInt(attr.value, 10);
										break;
									default:
										console.assert(false, "Illegal trkOn attribute.");
								}
							}

							for(i = 0; i < childNodes.length; ++i)
							{
								if(childNodes[i].nodeName === "inputControls")
								{
									trkOn.inputControls = new InputControls(childNodes[i]);
									break;
								}
							}

							return trkOn;
						}

						childNodes = trkOnsNode.childNodes;
						for(i = 0; i < childNodes.length; ++i)
						{
							switch(childNodes[i].nodeName)
							{
								case 'inputControls':
									returnArray.inputControls = new InputControls(childNodes[i]);
									break;
								case 'trkOn':
									returnArray.push(getTrkOn(childNodes[i]));
									break;
							}
						}
						return returnArray;
					}

					// returns an array of trkOn, possibly having an inputControls attribute
					function getTrkOffs(trkOffsNode)
					{
						var i, childNodes, returnArray = [];

						function getTrkOff(trkOffNode)
						{
							var i, attr,
							trkOff = {},
							attrLen = trkOffNode.attributes.length,
							childNodes = trkOffNode.childNodes;

							for(i = 0; i < attrLen; ++i)
							{
								attr = trkOffNode.attributes[i];
								switch(attr.name)
								{
									case "midiChannel":
										trkOff.midiChannel = parseInt(attr.value, 10);
										break;
									case "msPosition":
										trkOff.msPosition = parseInt(attr.value, 10);
										break;
									default:
										console.assert(false, "Illegal trkOff attribute.");
								}
							}

							for(i = 0; i < childNodes.length; ++i)
							{
								if(childNodes[i].nodeName === "inputControls")
								{
									trkOff.inputControls = new InputControls(childNodes[i]);
									break;
								}
							}

							return trkOff;
						}

						childNodes = trkOffsNode.childNodes;
						for(i = 0; i < childNodes.length; ++i)
						{
							switch(childNodes[i].nodeName)
							{
								case 'inputControls':
									returnArray.inputControls = new InputControls(childNodes[i]);
									break;
								case 'trkOff':
									returnArray.push(getTrkOff(childNodes[i]));
									break;
							}
						}
						return returnArray;
					}

					for(i = 0; i < nChildNodes; ++i)
					{
						switch(childNodes[i].nodeName)
						{
							case 'trkOns':
								returnObject.trkOns = getTrkOns(childNodes[i]);
								break;
							case 'trkOffs':
								returnObject.trkOffs = getTrkOffs(childNodes[i]);
								break;
						}
					}

					return returnObject;
				}

				function getPressures(pressuresNode)
				{					
					var i, childNodes = pressuresNode.childNodes, pressure, pressures = [];

					function getPressure(pressureNode)
					{
						var i, pressure, attrs, childNodes = pressureNode.childNodes;

						attrs = pressureNode.attributes;
						console.assert(attrs.length === 1 && attrs[0].name === 'midiChannel');
						pressure = {};
						pressure.midiChannel = parseInt(attrs[0].value, 10);

						for(i = 0; i < childNodes.length; ++i)
						{
							if(childNodes[i].nodeName === 'inputControls')
							{
								pressure.inputControls = new InputControls(childNodes[i]);
							}
						}
						return pressure;
					}

					for(i = 0; i < childNodes.length; ++i)
					{
						switch(childNodes[i].nodeName)
						{
							case 'inputControls':
								pressures.inputControls = new InputControls(childNodes[i]);
								break;
							case 'pressure':
								pressure = getPressure(childNodes[i]);
								pressures.push(pressure);
								break;
						}
					}
					return pressures;
				}
				
				for(i = 0; i < nAttributes; ++i)
				{
					attr = attrs[i];
					switch(attr.name)
					{
						case "notatedKey":
							inputNote.notatedKey = parseInt(attr.value, 10);
							break;
						default:
							console.assert(false, "Illegal inputNote attribute.");
					}
				}

				console.assert(inputNote.notatedKey !== undefined, "All inputNotes must have a notatedKey attribute.");

				for(i = 0; i < childNodes.length; ++i)
				{
					switch(childNodes[i].nodeName)
					{
						case "inputControls":
							// inputNote.inputControls can be undefined
							inputNote.inputControls = new InputControls(childNodes[i]);
							break;
						case "noteOn":
							inputNote.noteOn = getNoteOnOrNoteOff(childNodes[i]);
							break;
						case "pressures":
							inputNote.pressures = getPressures(childNodes[i]);
							break;
						case "noteOff":
							inputNote.noteOff = getNoteOnOrNoteOff(childNodes[i]);
							break;
					}
				}

				return inputNote;
			}

			returnValue.inputNotes = [];
			for(i = 0; i < childNodes.length; ++i)
			{
				switch(childNodes[i].nodeName)
				{
					case 'inputControls':
						returnValue.inputControls = new InputControls(childNodes[i]);
						break;
					case 'inputNote':
						returnValue.inputNotes.push(getInputNote(childNodes[i]));
						break;

				}
			}
			return returnValue;
		}

		if (!(this instanceof InputChordDef))
		{
			return new InputChordDef(inputNotesNode);
		}

		chordDef = getChordDef(inputNotesNode);
		if(chordDef.inputControls !== undefined)
		{
			this.inputControls = chordDef.inputControls;
		}
		
		console.assert(chordDef.inputNotes.length > 0);

		this.inputNotes = chordDef.inputNotes;

        return this;
    },

    // public API
    publicAPI =
    {
        // public InputChordDef(inputNotesNode) constructor.
        InputChordDef: InputChordDef
    };

	// returns an array of output midi channel indices
	InputChordDef.prototype.referencedOutputMidiChannels = function()
	{
		var i, j, inputNote, nInputNotes = this.inputNotes.length, nonUniqueOutputChannels = [], returnArray = [];

		function outChannels(noteOnOff)
		{
			var i,
			trkOns = noteOnOff.trkOns, nTrkOns = trkOns.length,
			trkOffs = noteOnOff.trkOffs, nTrkOffs = trkOffs.length,
			outputChannels = [];

			if(trkOns !== undefined)
			{
				for(i = 0; i < nTrkOns; ++i)
				{
					outputChannels.push(trkOns[i].midiChannel);
				}
			}
			if(trkOffs !== undefined)
			{
				for(i = 0; i < nTrkOffs; ++i)
				{
					outputChannels.push(trkOffs[i].midiChannel);
				}
			}

			return outputChannels;
		}

		function uniqueOutputChannels(nonUniqueOutputChannels)
		{
			var i, nAllOutputChannels = nonUniqueOutputChannels.length, rVal = [];
			for(i = 0; i < nAllOutputChannels; ++i)
			{
				if(rVal.indexOf(nonUniqueOutputChannels[i]) < 0)
				{
					rVal.push(nonUniqueOutputChannels[i]);
				}
			}
			return rVal;
		}

		for(i = 0; i < nInputNotes; ++i)
		{
			inputNote = this.inputNotes[i];
			if(inputNote.noteOn !== undefined)
			{
				nonUniqueOutputChannels = nonUniqueOutputChannels.concat(outChannels(inputNote.noteOn));
			}
			if(inputNote.pressures !== undefined)
			{
				for(j = 0; j < inputNote.pressures.length; ++j)
				{
					nonUniqueOutputChannels = nonUniqueOutputChannels.concat(inputNote.pressures[j].midiChannel);
				}
			}
			if(inputNote.noteOff !== undefined)
			{
				nonUniqueOutputChannels = nonUniqueOutputChannels.concat(outChannels(inputNote.noteOff));
			}
		}

		returnArray = uniqueOutputChannels(nonUniqueOutputChannels);

		return returnArray;
	};

    return publicAPI;

} ());

