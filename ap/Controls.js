/*
*  copyright 2012 James Ingram
*  http://james-ingram-act-two.de/
*
*  Code licensed under MIT
*  https://github.com/notator/assistant-performer/blob/master/License.md
*
*  ap/Controls.js
*  The _AP.controls namespace which defines the
*  Assistant Performer's Graphic User Interface. 
*/

/*jslint bitwise: false, nomen: true, plusplus: true, white: true */
/*global _AP: false,  window: false,  document: false, performance: false, console: false, alert: false, XMLHttpRequest: false */

_AP.namespace('_AP.controls');

_AP.controls = (function(document, window)
{
    "use strict";

    var
    tracksControl = _AP.tracksControl,
    Score = _AP.score.Score,
    sequence = _AP.sequence,
    player, // player can be set to sequence, or to MIDI input event handlers such as _AP.mono1 or _AP.keyboard1.
    SequenceRecording = _AP.sequenceRecording.SequenceRecording,
    sequenceToSMF = _AP.standardMidiFile.sequenceToSMF,

    midiAccess,
    score,
    svgControlsState = 'stopped', //svgControlsState can be 'disabled', 'stopped', 'paused', 'playing', 'settingStart', 'settingEnd'.
    svgPagesDiv,
    globalElements = {}, // assistantPerformer.html elements 
	cl = {}, // control layers

    // constants for control layer opacity values
    METAL = "1", // control layer is completely opaque
    SMOKE = "0.7", // control layer is smoky (semi-transparent)
    GLASS = "0", // control layer is completely transparent

    // options set in the top dialog
    options = {},

    scoreHasJustBeenSelected = false,

    // deletes the 'save' button created by createSaveMIDIFileButton() 
    deleteSaveMIDIFileButton = function()
    {
        var
        downloadLinkDiv = document.getElementById("downloadLinkDiv"), // the Element which will contain the link
        downloadLink, i;

        for(i = 0; i < downloadLinkDiv.childNodes.length; ++i)
        {
            if(downloadLinkDiv.childNodes[i].id === "downloadLink")
            {
                downloadLink = downloadLinkDiv.childNodes[i];
                break;
            }
        }

        if(downloadLink !== undefined)
        {
            // Need a small delay for the revokeObjectURL to work properly.
            window.setTimeout(function()
            {
                window.URL.revokeObjectURL(downloadLink.href); // window.URL is set in Main.js
                downloadLinkDiv.removeChild(downloadLink);
            }, 1500);
        }
    },

    // Returns true if any of the trackRecordings contain moments, otherwise false.
    // Used to prevent the creation of a 'save' button when there is nothing to save.
    hasData = function(nOutputVoices, trackRecordings)
    {
        var i, has = false;
        for(i = 0; i < nOutputVoices; ++i)
        {
            if(trackRecordings[i].moments.length > 0)
            {
                has = true;
                break;
            }
        }
        return has;
    },

    // Returns the name of the file to be downloaded
    // The date part of the name is formatted as
    //     year-month-day, with month and day always having two characters
    // so that downloaded files will list in order of creation time.
    getMIDIFileName = function(scoreName)
    {
        var
        d = new Date(),
        dayOfTheMonth = (d.getDate()).toString(),
        month = (d.getMonth() + 1).toString(),
        year = (d.getFullYear()).toString(),
        downloadName;

        if(month.length === 1)
        {
            month = "0".concat(month);
        }

        if(dayOfTheMonth.length === 1)
        {
            dayOfTheMonth = "0".concat(dayOfTheMonth);
        }

        downloadName = scoreName.concat('_', year, '-', month, '-', dayOfTheMonth, '.mid'); // .mid is added in case scoreName contains a '.'.

        return downloadName;
    },

    // Creates a button which, when clicked, downloads a standard MIDI file recording
    // of the sequenceRecording which has just stopped being recorded.
    // The performance may have ended by reaching the stop marker, or by the user clicking
    // the 'stop' button.
    // The 'save' button (and its associated recording) are deleted
    //    either when it is clicked (and the file has been downloaded)
    //    or when a new performance is started
    //    or when the user clicks the 'set options' button
    // Arguments:
    // scoreName is the name of the score (as selected in the main score selector).
    //     The name of the downloaded file is:
    //         scoreName + '_' + the current date (format:year-month-day) + '.mid'.
    //         (e.g. "Study 2c3.1_2013-01-08.mid")
    // sequenceRecording is a _AP.sequenceRecording.SequenceRecording object.
    // sequenceMsDuration is the total duration of the sequenceRecording in milliseconds (an integer).
    //      and determines the timing of the end-of-track events. When this is a recorded sequenceRecording,
    //      this value is simply the duration between the start and end markers.
    createSaveMIDIFileButton = function(scoreName, sequenceRecording, sequenceMsDuration)
    {
        var
        standardMidiFile,
        downloadName,
        downloadLinkDiv, downloadLinkFound = false, i, a,
        nOutputVoices = sequenceRecording.trackRecordings.length;

        if(hasData(nOutputVoices, sequenceRecording.trackRecordings))
        {
            downloadLinkDiv = document.getElementById("downloadLinkDiv"); // the Element which will contain the link

            if(downloadLinkDiv !== undefined)
            {
                for(i = 0; i < downloadLinkDiv.childNodes.length; ++i)
                {
                    if(downloadLinkDiv.childNodes[i].id === "downloadLink")
                    {
                        downloadLinkFound = true;
                    }
                }

                if(downloadLinkFound === false)
                {

                    downloadName = getMIDIFileName(scoreName);

                    standardMidiFile = sequenceToSMF(sequenceRecording, sequenceMsDuration);

                    a = document.createElement('a');
                    a.id = "downloadLink";
                    a.download = downloadName;
                    a.href = window.URL.createObjectURL(standardMidiFile); // window.URL is set in Main.js
                    a.innerHTML = '<img id="saveImg" border="0" src="images/saveMouseOut.png" alt="saveMouseOutImage" width="56" height="31">';

                    a.onmouseover = function() // there is an event argument, but it is ignored
                    {
                        var img = document.getElementById("saveImg");
                        img.src = "images/saveMouseOver.png";
                        a.style.cursor = 'default';
                    };

                    a.onmouseout = function() // there is an event argument, but it is ignored
                    {
                    	var img = document.getElementById("saveImg");
                    	if(img !== null)
                    	{
                    		img.src = "images/saveMouseOut.png";
						}
                    };

                    a.onclick = function() // there is an event argument, but it is ignored
                    {
                        deleteSaveMIDIFileButton();
                    };

                    downloadLinkDiv.appendChild(a);
                }
            }
        }
    },

    setMainOptionsState = function(mainOptionsState)
    {
        var
        scoreIndex = globalElements.scoreSelect.selectedIndex,
        outputDeviceIndex = globalElements.outputDeviceSelect.selectedIndex;

        switch(mainOptionsState)
        {
            case "toFront": // set main options visible with the appropriate controls enabled/disabled
            	globalElements.titleOptionsDiv.style.visibility = "visible";
                globalElements.globalSpeedDiv.style.display = "none";
                globalElements.startRuntimeButton.style.display = "none";
                globalElements.svgRuntimeControls.style.visibility = "hidden";
                globalElements.svgPagesFrame.style.visibility = "hidden";

            	// Note that the midi input device does not have to be set in order to enable performance.
                if(scoreIndex > 0 && outputDeviceIndex > 0)
                {
                	globalElements.globalSpeedDiv.style.display = "block";

                	if(globalElements.globalSpeedInput.value <= 0)
                	{
                		globalElements.globalSpeedInput.style.backgroundColor = _AP.constants.INPUT_ERROR_COLOR;
                		globalElements.startRuntimeButton.style.display = "none";
                		alert("Error: The speed must be set to a value greater than 0%!");
                	}
                	else
                	{
                		globalElements.globalSpeedInput.style.backgroundColor = "#FFFFFF";
                		globalElements.startRuntimeButton.style.display = "initial";
                	}
                }
                break;
            case "toBack": // set svg controls and score visible
                globalElements.titleOptionsDiv.style.visibility = "hidden";
                globalElements.svgRuntimeControls.style.visibility = "visible";
                globalElements.svgPagesFrame.style.visibility = "visible";
                break;
            default:
                throw "Unknown program state.";
        }
    },

    setStopped = function()
    {
        player.stop();

        score.moveRunningMarkerToStartMarker();

        score.allNotesOff(options.outputDevice);

        setMainOptionsState("toBack");

        cl.gotoOptionsDisabled.setAttribute("opacity", GLASS);

        /********* begin performance buttons *******************/
        cl.performanceButtonsDisabled.setAttribute("opacity", GLASS);

        // cl.goUnselected.setAttribute("opacity", METAL); -- never changes
        cl.pauseUnselected.setAttribute("opacity", GLASS);
        cl.pauseSelected.setAttribute("opacity", GLASS);
        cl.goDisabled.setAttribute("opacity", GLASS);

        cl.stopControlDisabled.setAttribute("opacity", SMOKE);

        //cl.setStartControlUnselected("opacity", METAL); -- never changes
        cl.setStartControlSelected.setAttribute("opacity", GLASS);
        cl.setStartControlDisabled.setAttribute("opacity", GLASS);

        //cl.setEndControlUnselected("opacity", METAL); -- never changes
        cl.setEndControlSelected.setAttribute("opacity", GLASS);
        cl.setEndControlDisabled.setAttribute("opacity", GLASS);

        // cl.sendStartToBeginningControlUnselected.setAttribute("opacity", METAL); -- never changes
        cl.sendStartToBeginningControlSelected.setAttribute("opacity", GLASS);
        cl.sendStartToBeginningControlDisabled.setAttribute("opacity", GLASS);

        // cl.sendStopToEndControlUnselected.setAttribute("opacity", METAL); -- never changes
        cl.sendStopToEndControlSelected.setAttribute("opacity", GLASS);
        cl.sendStopToEndControlDisabled.setAttribute("opacity", GLASS);
        /********* end performance buttons *******************/

        tracksControl.setDisabled(false);
    },

    // callback called when a performing sequenceRecording is stopped or has played its last message,
    // or when the player is stopped or has played its last subsequence.
    reportEndOfPerformance = function(sequenceRecording, performanceMsDuration)
    {
        var
        scoreName = globalElements.scoreSelect.options[globalElements.scoreSelect.selectedIndex].text;
        
        // Moment timestamps in the recording are shifted so as to be relative to the beginning of the
        // recording. Returns false if the if the sequenceRecording is undefined, null or has no moments.
        function setTimestampsRelativeToSequenceRecording(sequenceRecording)
        {
            var i, nOutputVoices = sequenceRecording.trackRecordings.length, trackRecording,
                j, nMoments, moment,
                offset, success = true;

            // Returns the earliest moment.timestamp in the sequenceRecording.
            // Returns Number.MAX_VALUE if sequenceRecording is undefined, null or has no moments.
            function findOffset(sequenceRecording)
            {
                var
                k, nTrks, trackRec,
                timestamp,
                rOffset = Number.MAX_VALUE;

                if(sequenceRecording !== undefined && sequenceRecording !== null)
                {
                    nTrks = sequenceRecording.trackRecordings.length;
                    for(k = 0; k < nTrks; ++k)
                    {
                        trackRec = sequenceRecording.trackRecordings[k];
                        if(trackRec.moments.length > 0)
                        {
                            timestamp = trackRec.moments[0].timestamp;
                            rOffset = (rOffset < timestamp) ? rOffset : timestamp;
                        }
                    }
                }

                return rOffset;
            }

            offset = findOffset(sequenceRecording);

            if(offset === Number.MAX_VALUE)
            {
                success = false;
            }
            else
            {
                for(i = 0; i < nOutputVoices; ++i)
                {
                    trackRecording = sequenceRecording.trackRecordings[i];
                    nMoments = trackRecording.moments.length;
                    for(j = 0; j < nMoments; ++j)
                    {
                        moment = trackRecording.moments[j];
                        moment.timestamp -= offset;
                    }
                }
            }
            return success;
        }

        if(setTimestampsRelativeToSequenceRecording(sequenceRecording))
        {
            createSaveMIDIFileButton(scoreName, sequenceRecording, performanceMsDuration);
        }

        // The moment.timestamps do not need to be restored to their original values here
        // because they will be re-assigned next time sequenceRecording.nextMoment() is called.

        setStopped();
        // the following line is important, because the stop button is also the pause button.
        svgControlsState = "stopped";
    },

    // callback called by a performing sequence. Reports the msPositionInScore of the
    // Moment curently being sent. When all the events in the span have been played,
    // reportEndOfPerformance() is called (see above).
    reportMsPos = function(msPositionInScore)
    {
        //console.log("Controls: calling score.advanceRunningMarker(msPosition), msPositionInScore=" + msPositionInScore);
        // If there is a graphic object in the score having msPositionInScore,
        // the running cursor is aligned to that object.
        score.advanceRunningMarker(msPositionInScore);
    },

    //svgControlsState can be 'disabled', 'stopped', 'paused', 'playing', 'settingStart', 'settingEnd'.
    setSvgControlsState = function(svgCtlsState)
    {
        function setDisabled()
        {
            setMainOptionsState("toFront");

            cl.gotoOptionsDisabled.setAttribute("opacity", SMOKE);

            /********* begin performance buttons *******************/
            cl.performanceButtonsDisabled.setAttribute("opacity", SMOKE);
            cl.goDisabled.setAttribute("opacity", SMOKE);
            cl.stopControlDisabled.setAttribute("opacity", SMOKE);
            cl.setStartControlDisabled.setAttribute("opacity", SMOKE);
            cl.setEndControlDisabled.setAttribute("opacity", SMOKE);
            cl.sendStartToBeginningControlDisabled.setAttribute("opacity", SMOKE);
            cl.sendStopToEndControlDisabled.setAttribute("opacity", SMOKE);
            /********* end performance buttons *******************/

            tracksControl.setDisabled(true);
        }

        // setStopped is outer function

        function setPaused()
        {
            if(options.livePerformance === true)
            {
                throw "Error: Assisted performances are never paused.";
            }

            if(player.isRunning())
            {
                player.pause();
            }

            score.allNotesOff(options.outputDevice);

            tracksControl.setDisabled(true);

            cl.gotoOptionsDisabled.setAttribute("opacity", SMOKE);

            cl.pauseSelected.setAttribute("opacity", METAL);
            cl.goDisabled.setAttribute("opacity", GLASS);

            cl.stopControlSelected.setAttribute("opacity", GLASS);
            cl.stopControlDisabled.setAttribute("opacity", GLASS);

            cl.setStartControlDisabled.setAttribute("opacity", SMOKE);
            cl.setEndControlDisabled.setAttribute("opacity", SMOKE);
            cl.sendStartToBeginningControlDisabled.setAttribute("opacity", SMOKE);
            cl.sendStopToEndControlDisabled.setAttribute("opacity", SMOKE);
        }

        function setPlaying(isLivePerformance)
        {
            var sequenceRecording, trackIsOnArray = [];

            deleteSaveMIDIFileButton();

            if(isLivePerformance === false && player.isPaused())
            {
                player.resume();
            }
            else if(player.isStopped())
            {
            	sequenceRecording = new SequenceRecording(player.outputTracks.length);

                // the running marker is at its correct position:
                // either at the start marker, or somewhere paused.
                score.setRunningMarkers();
                score.moveStartMarkerToTop(svgPagesDiv);
                score.getReadOnlyTrackIsOnArray(trackIsOnArray);

                player.play(trackIsOnArray, score.startMarkerMsPosition(), score.endMarkerMsPosition(), sequenceRecording);
            }

            if(isLivePerformance === true)
            {
                cl.goDisabled.setAttribute("opacity", SMOKE);
            }
            else
            {
                cl.goDisabled.setAttribute("opacity", GLASS);
            }
            cl.pauseUnselected.setAttribute("opacity", METAL);
            cl.pauseSelected.setAttribute("opacity", GLASS);

            tracksControl.setDisabled(true);

            cl.gotoOptionsDisabled.setAttribute("opacity", SMOKE);

            cl.stopControlSelected.setAttribute("opacity", GLASS);
            cl.stopControlDisabled.setAttribute("opacity", GLASS);

            cl.setStartControlDisabled.setAttribute("opacity", SMOKE);
            cl.setEndControlDisabled.setAttribute("opacity", SMOKE);
            cl.sendStartToBeginningControlDisabled.setAttribute("opacity", SMOKE);
            cl.sendStopToEndControlDisabled.setAttribute("opacity", SMOKE);
        }

        function setCursorAndEventListener(svgControlsState)
        {
            var i,
                s = score;

            if(s.markersLayers !== undefined)
            {
                switch(svgControlsState)
                {
                    case 'settingStart':
                        for(i = 0; i < s.markersLayers.length; ++i)
                        {
                            s.markersLayers[i].addEventListener('click', s.setStartMarkerClick, false);
                            s.markersLayers[i].style.cursor = "url('http://james-ingram-act-two.de/open-source/assistantPerformer/cursors/setStartCursor.cur'), crosshair";
                        }
                        break;
                    case 'settingEnd':
                        for(i = 0; i < s.markersLayers.length; ++i)
                        {
                            s.markersLayers[i].addEventListener('click', s.setEndMarkerClick, false);
                            s.markersLayers[i].style.cursor = "url('http://james-ingram-act-two.de/open-source/assistantPerformer/cursors/setEndCursor.cur'), pointer";
                        }
                        break;
                    default:
                        for(i = 0; i < s.markersLayers.length; ++i)
                        {
                            // According to
                            // https://developer.mozilla.org/en-US/docs/DOM/element.removeEventListener#Notes
                            // "Calling removeEventListener() with arguments which do not identify any currently 
                            //  registered EventListener on the EventTarget has no effect."
                            s.markersLayers[i].removeEventListener('click', s.setStartMarkerClick, false);
                            s.markersLayers[i].removeEventListener('click', s.setEndMarkerClick, false);
                            s.markersLayers[i].style.cursor = 'auto';
                        }
                        break;
                }
            }
        }

        function setSettingStart()
        {
            tracksControl.setDisabled(true);

            cl.gotoOptionsDisabled.setAttribute("opacity", SMOKE);

            cl.goDisabled.setAttribute("opacity", SMOKE);
            cl.stopControlDisabled.setAttribute("opacity", SMOKE);

            cl.setStartControlSelected.setAttribute("opacity", METAL);
            cl.setStartControlDisabled.setAttribute("opacity", GLASS);

            cl.setEndControlDisabled.setAttribute("opacity", SMOKE);
            cl.sendStartToBeginningControlDisabled.setAttribute("opacity", SMOKE);
            cl.sendStopToEndControlDisabled.setAttribute("opacity", SMOKE);

            setCursorAndEventListener('settingStart');
        }

        function setSettingEnd()
        {
            tracksControl.setDisabled(true);

            cl.gotoOptionsDisabled.setAttribute("opacity", SMOKE);

            cl.goDisabled.setAttribute("opacity", SMOKE);
            cl.stopControlDisabled.setAttribute("opacity", SMOKE);
            cl.setStartControlDisabled.setAttribute("opacity", SMOKE);

            cl.setEndControlSelected.setAttribute("opacity", METAL);
            cl.setEndControlDisabled.setAttribute("opacity", GLASS);

            cl.sendStartToBeginningControlDisabled.setAttribute("opacity", SMOKE);
            cl.sendStopToEndControlDisabled.setAttribute("opacity", SMOKE);

            setCursorAndEventListener('settingEnd');
        }

        svgControlsState = svgCtlsState;

        setCursorAndEventListener('default');

        switch(svgControlsState)
        {
            case 'disabled':
                setDisabled(); // enables the main options panel
                break;
            case 'stopped':
                setStopped();
                break;
            case 'paused':
                if(options.livePerformance === false) // live performances cannot be paused
                {
                    setPaused();
                }
                break;
        	case 'playing':
        		try
        		{
        			setPlaying(options.livePerformance);
        		}
        		catch(errorMessage)
        		{
        			alert("ji: runtime browser error: \n\n" +
					"browser's error message: \n" + errorMessage);
        			//window.close();
        			throw errorMessage;
        		}
                break;
            case 'settingStart':
                setSettingStart();
                break;
            case 'settingEnd':
                setSettingEnd();
                break;
        }
    },

    // sets the options in the input device selector
	setMIDIInputDeviceSelector = function(midiAccess)
	{
		var
		option,
		is = globalElements.inputDeviceSelect; // = document.getElementById("inputDeviceSelect")

		is.options.length = 0; // important when called by midiAccess.onstatechange 

		option = document.createElement("option");
		option.text = "choose a MIDI input device";
		is.add(option, null);
		midiAccess.inputs.forEach(function(port)
		{
			//console.log('input id:', port.id, ' input name:', port.name);
			option = document.createElement("option");
			option.inputDevice = port;
			option.text = port.name;
			is.add(option, null);
		});
	},

	// sets the options in the output device selector
	setMIDIOutputDeviceSelector = function(midiAccess)
	{
		var
		option,
		os = globalElements.outputDeviceSelect; // = document.getElementById("outputDeviceSelect")

		os.options.length = 0; // important when called by midiAccess.onstatechange

		option = document.createElement("option");
		option.text = "choose a MIDI output device";
		os.add(option, null);
		midiAccess.outputs.forEach(function(port)
		{
			//console.log('output id:', port.id, ' output name:', port.name);
			option = document.createElement("option");
			option.outputDevice = port;
			option.text = port.name;
			os.add(option, null);
		});
	},

	onMIDIDeviceStateChange = function(e)
	{
		var
		is = globalElements.inputDeviceSelect, // = document.getElementById("inputDeviceSelect")
		os = globalElements.outputDeviceSelect, // = document.getElementById("outputDeviceSelect")
		inputOptionsLength = is.options.length,
		currentOutputDeviceIndex = os.selectedIndex;

		switch(e.port.type)
		{
			case "input":
				setMIDIInputDeviceSelector(midiAccess);
				if(inputOptionsLength < is.options.length)
				{
					// input device added
					is.selectedIndex = is.options.length - 1;
				}
				else
				{
					// input device removed
					is.selectedIndex = 0;
				}
				break;
			case "output":
				setMIDIOutputDeviceSelector(midiAccess);
				// Output devices are currently handled differently from the input devices...
				// (I don't want the output device selector's selected index to change 
				// every time an input device is connected or disconnected.)
				if(currentOutputDeviceIndex < os.options.length)
				{
					os.selectedIndex = currentOutputDeviceIndex;
				}
				else
				{
					os.SelectedIndex = 0;
				}
				break;
		}
	},

    doAlertThrow = function(functionLocation, errorMessage)
    {
    	var msg = errorMessage;
    	if(functionLocation !== "")
    	{
    		msg = msg + "\n\nError in " + functionLocation;
		}
    	alert(msg);

    	throw errorMessage;
    },

    // Defines the window.svgLoaded(...) function.
    // Sets up the pop-up menues for scores and MIDI input and output devices.
    init = function(mAccess)
    {
        function getGlobalElements()
        {
        	globalElements.titleOptionsDiv = document.getElementById("titleOptionsDiv");
            globalElements.inputDeviceSelect = document.getElementById("inputDeviceSelect");
            globalElements.scoreSelect = document.getElementById("scoreSelect");
            globalElements.outputDeviceSelect = document.getElementById("outputDeviceSelect");
            globalElements.globalSpeedDiv = document.getElementById("globalSpeedDiv");
            globalElements.globalSpeedInput = document.getElementById("globalSpeedInput");
            globalElements.startRuntimeButton = document.getElementById("startRuntimeButton");

            globalElements.svgPagesFrame = document.getElementById("svgPagesFrame");
            globalElements.svgRuntimeControls = document.getElementById("svgRuntimeControls");
        }

        // resets the score selector in case the browser has cached the last value
        function initScoreSelector(runningMarkerHeightChanged)
        {
            globalElements.scoreSelect.selectedIndex = 0;
            score = new Score(runningMarkerHeightChanged); // an empty score, with callback function
        }

        function getControlLayers(document)
        {
            cl.gotoOptionsDisabled = document.getElementById("gotoOptionsDisabled");

            cl.performanceButtonsDisabled = document.getElementById("performanceButtonsDisabled");

            cl.pauseUnselected = document.getElementById("pauseUnselected");
            cl.pauseSelected = document.getElementById("pauseSelected");
            cl.goDisabled = document.getElementById("goDisabled");

            cl.stopControlSelected = document.getElementById("stopControlSelected");
            cl.stopControlDisabled = document.getElementById("stopControlDisabled");

            cl.setStartControlSelected = document.getElementById("setStartControlSelected");
            cl.setStartControlDisabled = document.getElementById("setStartControlDisabled");

            cl.setEndControlSelected = document.getElementById("setEndControlSelected");
            cl.setEndControlDisabled = document.getElementById("setEndControlDisabled");

            cl.sendStartToBeginningControlSelected = document.getElementById("sendStartToBeginningControlSelected");
            cl.sendStartToBeginningControlDisabled = document.getElementById("sendStartToBeginningControlDisabled");

            cl.sendStopToEndControlSelected = document.getElementById("sendStopToEndControlSelected");
            cl.sendStopToEndControlDisabled = document.getElementById("sendStopToEndControlDisabled");
        }

        // callback passed to score. Called when the running marker moves to a new system.
        function runningMarkerHeightChanged(runningMarkerYCoordinates)
        {
            var div = svgPagesDiv,
            height = Math.round(parseFloat(div.style.height));

            if(runningMarkerYCoordinates.bottom > (height + div.scrollTop))
            {
                div.scrollTop = runningMarkerYCoordinates.top - 10;
            }
        }

        function setSvgPagesDivHeight()
        {
            svgPagesDiv = document.getElementById("svgPagesFrame");
            svgPagesDiv.style.height = window.innerHeight - 43;
        }

    	try
    	{
    		midiAccess = mAccess;

    		getGlobalElements();

    		setMIDIInputDeviceSelector(midiAccess);
    		setMIDIOutputDeviceSelector(midiAccess);

    		// update the device selectors when devices get connected, disconnected, opened or closed
    		midiAccess.addEventListener('statechange', onMIDIDeviceStateChange, false);

    		initScoreSelector(runningMarkerHeightChanged);

    		setSvgPagesDivHeight();

    		getControlLayers(document);

    		setSvgControlsState('disabled');
    	}
    	catch(errorMessage)
    	{
    		doAlertThrow("Controls.init()", errorMessage);
    	}
    },

	// The Go control can be clicked directly.
	// Also, it is called automatically when assisted performances start.
	goControlClicked = function()
	{
		try
		{
			if(svgControlsState === 'stopped' || svgControlsState === 'paused')
			{
				setSvgControlsState('playing');
			}
			else if(svgControlsState === 'playing')
			{
				setSvgControlsState('paused');
			}
		}
		catch(errorMessage)
		{
			doAlertThrow("Controls.goControlClicked()", errorMessage);
		}
	},

    // called when the user clicks a control in the GUI
    doControl = function(controlID)
    {
    	// This function analyses the score's id string in the scoreSelector in assistantPerformer.html,
    	// and uses the information to load the score's svg files into the "svgPagesFrame" div,
    	// The score is actually analysed when the Start button is clicked.
    	function setScore()
    	{
    		var scoreInfo;

    		// Returns a scoreInfo object having two attributes constructed from the value string in the scoreSelector's
    		// currently selected options element. (See assistantPerformer.html.)
    		// The option value string contains a path= setting and optionally, after a ',', an inputHandler= setting.
    		// The returned attributes are:
    		//      scoreInfo.path -- e.g. "Song Six/Song Six (scroll)" or "Song Six/Song Six (14 pages)"
    		//      scoreInfo.inputHandler -- is "none", by default, if not set in the value string
    		// The path= setting includes the complete path from the Assistant Performer's "scores" folder
    		// to the page(s) to be used, and ends with either "(scroll)" or "(<nPages> pages)" -- e.g. "(14 pages)".
    		// "Song Six/Song Six (scroll).svg" is a file. If separate pages are to be used, their paths will be:
    		// "Song Six/Song Six page 1.svg", "Song Six/Song Six page 2.svg", "Song Six/Song Six page 3.svg" etc.
    		// Note that if annotated page(s) are to be used, their path= value will includes the name of their
    		// folder (e.g. "Song Six/annotated/Song Six (14 pages)").
    		// If the score contains input voices, the inputHandler= option will be defined: It selects one of the
    		// Assistant Performer's inputHandlers. If omitted, the inputHandler is given its default value "none".
    		function getScoreInfo()
    		{
    			var scoreSelectorElem = document.getElementById("scoreSelect"),
                    scoreInfoStrings, scoreInfoString, scoreInfo;

    			function getScoreInfoStrings(scoreSelectorElem)
    			{
    				var scoreInfoStrings = [], i, childNode;

    				for(i = 0 ; i < scoreSelectorElem.childNodes.length; ++i)
    				{
    					childNode = scoreSelectorElem.childNodes[i];
    					if(childNode.value !== undefined)
    					{
    						scoreInfoStrings.push(childNode.value);
    					}
    				}
    				return scoreInfoStrings;
    			}

    			function analyseString(infoString)
    			{
    				var i, scoreInfo = {}, components;

    				scoreInfo.inputHandler = "none"; // default

    				components = infoString.split(",");
    				for(i = 0; i < components.length; ++i)
    				{
    					components[i] = components[i].trim();
    					if(components[i].slice(0, 5) === "path=")
    					{
    						scoreInfo.path = components[i].slice(5);
    					}
    					else if(components[i].slice(0, 13) === "inputHandler=")// e.g. "keyboard1"
    					{
    						scoreInfo.inputHandler = components[i].slice(13);
    					}
    					else
    					{
    						throw "Illegal score option.";
    					}
    				}

    				return scoreInfo;
    			}

    			scoreInfoStrings = getScoreInfoStrings(scoreSelectorElem);

    			scoreInfoString = scoreInfoStrings[scoreSelectorElem.selectedIndex];

    			scoreInfo = analyseString(scoreInfoString);

    			return scoreInfo;
    		}

    		function embedPageCode(url)
    		{
    			var code = "<embed " +
								"src=\'" + url + "\' " +
								"content-type=\'image/svg+xml\' " +
								"class=\'svgPage\' />";
    			return code;
    		}

    		// Returns the URL of the scores directory. This can either be a file:
    		// e.g. "file:///D:/Visual Studio/Projects/MyWebsite/james-ingram-act-two/open-source/assistantPerformer/scores/"
    		// served from IIS:
    		// e.g. "http://localhost:49560/james-ingram-act-two.de/open-source/assistantPerformer/scores/"
    		// or on the web:
    		// e.g. "http://james-ingram-act-two.de/open-source/assistantPerformer/scores/"
			// Note that Chrome needs to be started with its --allow-file-access-from-files flag to use the first of these.
    		function scoresURL(documentURL)
    		{
    			var
				apIndex = documentURL.search("assistantPerformer.html"),
				url = documentURL.slice(0, apIndex) + "scores/";

    			return url;
    		}

    		function getPathData(path)
    		{
    			var pathData = {}, components;

    			components = path.split("(");
    			if(components[0][components[0].length - 1] !== ' ')
    			{
    				alert("Error in pages path string:\nThere must be a space character before the '('");
    			}
    			pathData.basePath = components[0] + "page ";

    			// the second search argument is a regular expression for a single ')' character.
    			if(components[1].search("page") < 0 || components[1].search(/\)/i) < 0) 
    			{
    				alert("Error in pages path string:\nThe number of pages is not correctly defined in the final bracket.");
    			}

    			pathData.nPages = parseInt(components[1], 10);
    			if(pathData.nPages === null || pathData.nPages === undefined || pathData.nPages < 1)
    			{
    				alert("Error in pages path string:\nIllegal number of pages.");
    			}

    			return pathData;
    		}

    		function setPages(scoreInfo)
    		{
    			var i, rootURL,
                    svgPagesFrame,
                    embedCode = "",
					pathData,
					pageURL;

    			rootURL = scoresURL(document.URL);

    			if(scoreInfo.path.search("(scroll)") >= 0)
    			{
    				pageURL = rootURL + scoreInfo.path + ".svg";
    				embedCode += embedPageCode(pageURL);
    			}
    			else
    			{
    				pathData = getPathData(scoreInfo.path);

    				for(i = 0; i < pathData.nPages; ++i)
    				{
    					pageURL = rootURL + pathData.basePath + (i + 1).toString(10) + ".svg";
    					embedCode += embedPageCode(pageURL);
    				}
    			}

    			svgPagesFrame = document.getElementById('svgPagesFrame');
    			svgPagesFrame.innerHTML = embedCode;
    		}

    		function setOptionsInputHandler(scoreInfoInputHandler)
    		{
    			if(scoreInfoInputHandler === "none")
    			{
    				globalElements.inputDeviceSelect.selectedIndex = 0;
    				globalElements.inputDeviceSelect.options[0].text = "this score does not accept live input";
    				globalElements.inputDeviceSelect.disabled = true;
    				options.inputHandler = undefined;
    			}
    			else
    			{
    				// globalElements.inputDeviceSelect.selectedIndex is not changed here
    				globalElements.inputDeviceSelect.options[0].text = "choose a MIDI input device";
    				globalElements.inputDeviceSelect.disabled = false;

    				switch(scoreInfoInputHandler)
    				{
    					case "keyboard1":
    						options.inputHandler = _AP.keyboard1;
    						break;
    					default:
    						console.assert(false, "Error: unknown scoreInfo.inputType");
    						break;
    				}
    			}
    		}

    		scoreInfo = getScoreInfo();

    		setPages(scoreInfo);

    		setOptionsInputHandler(scoreInfo.inputHandler);

    		svgPagesDiv.scrollTop = 0;
    		scoreHasJustBeenSelected = true;
    	}

        // used when the control automatically toggles back
        // toggleBack('setStartControlSelected')
        function toggleBack(selected)
        {
            selected.setAttribute("opacity", "1");
            window.setTimeout(function()
            {
                selected.setAttribute("opacity", "0");
            }, 200);
        }

    	// goControlClicked is an outer function

        function stopControlClicked()
        {
            if(svgControlsState === 'paused')
            {
                toggleBack(cl.stopControlSelected);
                setSvgControlsState('stopped');
            }

            if(svgControlsState === 'playing')
            {
                toggleBack(cl.stopControlSelected);
                setSvgControlsState('stopped');
            }
        }

        function setStartControlClicked()
        {
            if(svgControlsState === 'stopped')
            {
                setSvgControlsState('settingStart');
            }
            else if(svgControlsState === 'settingStart')
            {
                setSvgControlsState('stopped');
                score.moveRunningMarkerToStartMarker();
            }
        }

        function setEndControlClicked()
        {
            if(svgControlsState === 'stopped')
            {
                setSvgControlsState('settingEnd');
            }
            else if(svgControlsState === 'settingEnd')
            {
                setSvgControlsState('stopped');
            }
        }

        function sendStartToBeginningControlClicked()
        {
            if(svgControlsState === 'stopped')
            {
                toggleBack(cl.sendStartToBeginningControlSelected);
                score.sendStartMarkerToStart();
                score.moveRunningMarkerToStartMarker();
            }
        }

        function sendStopToEndControlClicked()
        {
            if(svgControlsState === 'stopped')
            {
                toggleBack(cl.sendStopToEndControlSelected);
                score.sendEndMarkerToEnd();
            }
        }

    	try
    	{
    		// setMIDIDevices is now called in beginRuntime().
    		// There is no reason to react here to the inputDeviceSelect changing.
    		//if(controlID === "inputDeviceSelect")
    		//{
    		//	//setMIDIDevices();
    		//	if(globalElements.scoreSelect.selectedIndex > 0)
    		//	{
    		//		setScore();
    		//	}
    		//}

    		if(controlID === "scoreSelect")
    		{
    			if(globalElements.scoreSelect.selectedIndex > 0)
    			{
    				setScore();
    			}
    			else
    			{
    				setMainOptionsState("toFront"); // hides startRuntimeButton
    			}
    		}

    		// setMIDIDevices is now called in beginRuntime().
			// There is no reason to react here to the outputDeviceSelect changing.
    		//if(controlID === "outputDeviceSelect")
    		//{
    		//	//setMIDIDevices();
    		//}

    		/**** controls in options panel ***/
    		if(controlID === "inputDeviceSelect"
			|| controlID === "scoreSelect"
			|| controlID === "outputDeviceSelect"
			|| controlID === "globalSpeedInput")
    		{
    			setMainOptionsState("toFront"); // enables only the appropriate controls
    		}

    		/*** SVG controls ***/
    		if(cl.performanceButtonsDisabled.getAttribute("opacity") !== SMOKE)
    		{
    			switch(controlID)
    			{
    				case "goControl":
    					goControlClicked();
    					break;
    				case "stopControl":
    					stopControlClicked();
    					break;
    				case "setStartControl":
    					setStartControlClicked();
    					break;
    				case "setEndControl":
    					setEndControlClicked();
    					break;
    				case "sendStartToBeginningControl":
    					sendStartToBeginningControlClicked();
    					break;
    				case "sendStopToEndControl":
    					sendStopToEndControlClicked();
    					break;
    				default:
    					break;
    			}
    		}

    		if(controlID === "gotoOptions")
    		{
    			deleteSaveMIDIFileButton();

    			midiAccess.addEventListener('statechange', onMIDIDeviceStateChange, false);

    			if(cl.gotoOptionsDisabled.getAttribute("opacity") !== SMOKE)
    			{
    				setSvgControlsState('disabled');
    				score.moveStartMarkerToTop(svgPagesDiv);
    				scoreHasJustBeenSelected = false;
    			}
    		}
    	}
    	catch(errorMessage)
    	{
    		doAlertThrow("Controls.doControl()", errorMessage);
    	}
    },

    // functions for adjusting the appearance of the score options
    showOverRect = function(overRectID, disabledID)
    {
    	var overRectElem = document.getElementById(overRectID),
            disabledElem = document.getElementById(disabledID),
            disabledOpacity = disabledElem.getAttribute("opacity");

        if(disabledOpacity !== SMOKE)
        {
            overRectElem.setAttribute("opacity", METAL);
        }
    },
    hideOverRect = function(overRectID)
    {
        var overRect = document.getElementById(overRectID);

        overRect.setAttribute("opacity", GLASS);
    },

    // Called when the Start button is clicked.
    // The score selector sets the array of svgScorePage urls.
    // The Start button is enabled when a score and MIDI output have been selected.
    // It does not require a MIDI input.
    beginRuntime = function()
    {
    	function setMIDIDevices(options)
    	{
    		var i,
			inSelector = document.getElementById("inputDeviceSelect"),
			outSelector = document.getElementById("outputDeviceSelect");

    		// inputDevices are opened and closed by the input event handling module (e.g. Keyboard1)
    		if(inSelector.selectedIndex === 0)
    		{
    			options.inputDevice = null;
    		}
    		else
    		{
    			options.inputDevice = inSelector.options[inSelector.selectedIndex].inputDevice;
    		}

    		for(i = 1; i < outSelector.options.length; ++i)
    		{
    			outSelector.options[i].outputDevice.close();
    		}

    		if(outSelector.selectedIndex === 0)
    		{
    			options.outputDevice = null;
    		}
    		else
    		{
    			options.outputDevice = outSelector.options[outSelector.selectedIndex].outputDevice;
    			options.outputDevice.open();
    		}
    	}

    	function getTracksAndPlayer(score, options)
    	{
    		var tracksData;

    		if(scoreHasJustBeenSelected)
    		{
    			// everything except the timeObjects (which have to take account of speed)
    			score.getEmptyPagesAndSystems(options.livePerformance);
    		}

    		// tracksData will contain the following defined attributes:
    		//		inputTracks[]
    		//		outputTracks[]
    		//		if inputTracks contains one or more tracks, the following attributes are also defined (on tracksData):
    		//			inputKeyRange.bottomKey
    		//			inputKeyRange.topKey
    		tracksData = score.getTracksData(options.globalSpeed); // can throw an exception if the speed is too great

    		if(options.livePerformance)
    		{
    			player = options.inputHandler; // e.g. keyboard1 -- the "prepared piano"
    			player.outputTracks = tracksData.outputTracks; // public player.outputTracks is needed for sending track initialization messages
    			player.init(options.inputDevice, options.outputDevice, tracksData, reportEndOfPerformance, reportMsPos);
    		}
    		else
    		{
    			player = sequence; // sequence is a namespace, not a class.
    			player.outputTracks = tracksData.outputTracks; // public player.outputTracks is needed for sending track initialization messages
    			player.init(options.outputDevice, reportEndOfPerformance, reportMsPos);
    		}

    		// The tracksControl is in charge of refreshing the entire display, including both itself and the score.
    		// It calls the score.refreshDisplay(isLivePerformance, trackIsOnArray) function as a callback when one
    		// of its track controls is turned on or off.
    		// score.refreshDisplay(isLivePerformance, trackIsOnArray) simply tells the score to repaint itself.
    		// Repainting includes using the correct staff colours, but the score may also update the position of
    		// its start marker (which always starts on a chord) if a track is turned off.
    		tracksControl.init(tracksData.outputTracks.length, tracksData.inputTracks.length, options.livePerformance, score.refreshDisplay);
    	}

    	options.livePerformance = (globalElements.inputDeviceSelect.disabled === false && globalElements.inputDeviceSelect.selectedIndex > 0); 
    	options.globalSpeed = globalElements.globalSpeedInput.value / 100;

    	try
    	{
    		setMIDIDevices(options);

    		// This function can throw an exception
    		// (e.g. if an attempt is made to create an event that has no duration).
    		getTracksAndPlayer(score, options);

    		midiAccess.removeEventListener('statechange', onMIDIDeviceStateChange, false);

    		score.refreshDisplay(); // undefined trackIsOnArray

    		score.moveStartMarkerToTop(svgPagesDiv);

    		setSvgControlsState('stopped');

    		if(options.livePerformance === true)
    		{
    			goControlClicked();
    		}
    	}
    	catch(errorMessage)
    	{
    		doAlertThrow("", errorMessage);
    	}
    },

    publicAPI =
    {
        init: init,

        doControl: doControl,
        showOverRect: showOverRect,
        hideOverRect: hideOverRect,

        beginRuntime: beginRuntime
    };
    // end var

    return publicAPI;

}(document, window));
