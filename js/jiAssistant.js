/*
*  copyright 2012 James Ingram
*  http://james-ingram-act-two.de/
*
*  Code licensed under MIT
*  https://github.com/notator/assistant-performer/blob/master/License.md
*
*  jiAssistant.js
*  The JI_NAMESPACE.assistant namespace which defines the
*    Assistant() constructor.
*  
*/

JI_NAMESPACE.namespace('JI_NAMESPACE.assistant');

JI_NAMESPACE.assistant = (function (window)
{
    "use strict";
    // begin var
    var outputDevice,
        tracksControl,
    // MCD contains the following constant fields used for creating midi messages
    // {
    //     createMIDIMessage: MIDIAccess.createMIDIMessage,
    //     // MIDI commands
    //     NOTE_OFF: 0x80,
    //     NOTE_ON: 0x90,
    //     CONTROL_CHANGE: 0xB0,
    //     PROGRAM_CHANGE: 0xC0,
    //     CHANNEL_PRESSURE: 0xD0,
    //     PITCH_BEND: 0xE0,
    //     // MIDI controls
    //     PAN_CONTROL: 10,
    //     MODWHEEL_CONTROL: 1,
    //     EXPRESSION_CONTROL: 11
    // }
        MCD,

    // midi input message types
        UNKNOWN = 0,
        ILLEGAL_INDEX = 1,
        END_OF_SEQUENCE = 2,
        CHANNEL_PRESSURE = 3, // generated by my E-MU keyboard, when "Aftertouch" is switched on.
        AFTERTOUCH = 4, // from EWI breath controller
        MODULATION_WHEEL = 5, // from EWI bite controller or E-MU modulation wheel
        PITCH_WHEEL = 6, // from EWI pitch bend controllers or E-MU pitch wheel
        NOTE_ON = 7,
        NOTE_OFF = 8,

        options, // performance options. This is the options object in jiAPControls.
        reportEndOfPerformance, // callback
        reportMsPosition, // callback

        mainSequence, // the sequence from which the sequences are made
        subsequences, // an array of subsequence. Each subsequence is a Sequence.

    // these variables are initialized by playSpan() and used by handleMidiIn() 
        startIndex = -1,
        endIndex = -1,
        currentIndex = -1, // the index of the currently playing subsequence (which will be stopped when a noteOn or noteOff arrives).
        nextIndex = -2, // the index of the subsequence which will be played when a noteOn msg arrives (initially != startIndex) 
        prevSubsequenceStartNow = 0.0, // used only with the relative durations option
        pausedNow = 0.0, // used only with the relative durations option (the time at which the subsequence was paused).

        stopped = true,
        paused = false,
        midiInHandler,

        currentLivePerformersKeyPitch = -1, // -1 means "no key depressed". This value is set when the live performer sends a noteOn

        init = function (messageCreationData)
        {
            MCD = messageCreationData;
        },

    // makeSubsequences creates the private subsequences array inside the assistant.
    // This function is called when options.assistedPerformance === true and the Start button is clicked in the upper options panel.
    // See the comment to Sequence.getSubsequences().
        makeSubsequences = function (livePerformersTrackIndex, mainSequence)
        {
            subsequences = mainSequence.getSubsequences(livePerformersTrackIndex);
        },

        setState = function (state)
        {

            function closeInputDevice(options)
            {
                if (options.inputDevice !== undefined && options.inputDevice !== null)
                {
                    options.inputDevice.close();
                }
            }

            switch (state)
            {
                case "stopped":
                    // these variables are also set in playSpan() when the state is first set to "running"
                    startIndex = -1;
                    endIndex = -1; // the index of the (unplayed) end chord or rest or endBarline
                    currentIndex = -1;
                    nextIndex = -1;
                    prevSubsequenceStartNow = 0.0; // used only with the relative durations option
                    pausedNow = 0.0; // used only with the relative durations option (the time at which the subsequence was paused).
                    stopped = true;
                    paused = false;
                    closeInputDevice(options);
                    break;
                case "paused":
                    stopped = false;
                    paused = true;
                    closeInputDevice(options);
                    break;
                case "running":
                    stopped = false;
                    paused = false;
                    options.getInputDevice(midiInHandler);
                    break;
                default:
                    throw "Unknown sequencer state!";
            }
        },

    // Can only be called when paused is true.
        resume = function ()
        {
            if (paused === true)
            {
                if (options.assistantUsesAbsoluteDurations === false)
                {
                    prevSubsequenceStartNow += (window.performance.webkitNow() - pausedNow);
                }
                subsequences[currentIndex].resume();
                setState("running");
            }
        },

    // Can only be called while running
    // (stopped === false && paused === false)
        pause = function ()
        {
            if (stopped === false && paused === false)
            {
                pausedNow = window.performance.webkitNow();
                subsequences[currentIndex].pause();
                setState("paused");
            }
            else
            {
                throw "Attempt to pause a stopped or paused sequence.";
            }
        },

        isStopped = function ()
        {
            return stopped === true;
        },

        isPaused = function ()
        {
            return paused === true;
        },

    // Can only be called while running
    // (stopped === false)
        stop = function ()
        {
            var i, nSubsequences = subsequences.length;

            if (stopped === false)
            {
                setState("stopped");

                if (options.assistantUsesAbsoluteDurations === false)
                {
                    // reset the subsequences
                    // (During the assisted performance, the message.timestamps have changed according
                    //  to the live performer's speed, but the midiMoment.timestamps have not).
                    for (i = 0; i < nSubsequences; ++i)
                    {
                        subsequences[i].revertMessageTimestamps();
                    }
                }

                reportEndOfPerformance();
            }
            else
            {
                throw "Attempt to stop a stopped performance.";
            }
        },

    // If options.assistedPerformance === true, this is where input MIDI messages arrive, and where processing is going to be done.
    // Uses 
    //  startIndex (= -1 when stopped),
    //  endIndex  (= -1 when stopped),
    //  currentIndex (= -1 when stopped) the index of the currently playing subsequence (which should be stopped when a noteOn or noteOff arrives).
    //  nextIndex (= -1 when stopped) the index of the subsequence which will be played when a noteOn msg arrives
        handleMidiIn = function (msg)
        {
            var inputMsgType,
                mcd = MCD;

            // getInputMessageType returns one of the following constants:
            // UNKNOWN = 0, ILLEGAL_INDEX = 1, END_OF_SEQUENCE = 2, CHANNEL_PRESSURE = 3, AFTERTOUCH = 4,
            // MODULATION_WHEEL = 5, PITCH_WHEEL = 6, NOTE_ON = 7, NOTE_OFF = 8
            function getInputMessageType(msg)
            {
                var type = UNKNOWN;

                switch (msg.command)
                {
                    case 0xD0:
                        // This type is generated by my E-MU keyboard when "Aftertouch" is switched on.
                        type = CHANNEL_PRESSURE;
                        break;
                    case 0xA0:
                        // generated by EWI controller
                        type = AFTERTOUCH;
                        break;
                    case 0xB0:
                        if (msg.data1 === 1)
                        {
                            type = MODULATION_WHEEL;
                        }
                        break;
                    case 0xE0:
                        type = PITCH_WHEEL;
                        break;
                    case 0x90:
                        if (msg.data2 === 0) // velocity 0
                        {
                            type = NOTE_OFF;
                        }
                        else
                        {
                            type = NOTE_ON;
                        }
                        break;
                    case 0x80:
                        type = NOTE_OFF;
                        break;
                    default:
                        type = UNKNOWN;
                        break;
                }
                if (type === UNKNOWN)
                {
                    if (nextIndex === endIndex)
                    {
                        type = END_OF_SEQUENCE;
                    }
                    else if (nextIndex < 0 || nextIndex >= subsequences.length)
                    {
                        type = ILLEGAL_INDEX;
                    }
                }
                return type;
            }

            function silentlyCompleteCurrentlyPlayingSubsequence()
            {
                // currentIndex is the index of the currently playing subsequence
                // (which should be silently completed when a noteOn arrives).
                if (currentIndex >= 0 && subsequences[currentIndex].isStopped() === false)
                {
                    subsequences[currentIndex].finishSilently();
                }
            }

//            function stopCurrentlyPlayingSubsequence()
//            {
//                // currentIndex is the index of the currently playing subsequence
//                // (which should be stopped when a noteOn or noteOff arrives).
//                if (currentIndex >= 0 && subsequences[currentIndex].isStopped() === false)
//                {
//                    subsequences[currentIndex].stop();
//                }
//            }

            function playSubsequence(subsequence, options)
            {
                var now = window.performance.webkitNow(), // in the time frame used by sequences
                    prevSubsequenceScoreMsDuration,
                    durationFactor;

                if (options.assistantUsesAbsoluteDurations === false)
                {
                    if (currentIndex > 0)
                    {
                        prevSubsequenceScoreMsDuration = subsequences[currentIndex].msPositionInScore - subsequences[currentIndex - 1].msPositionInScore;
                        durationFactor = (now - prevSubsequenceStartNow) / prevSubsequenceScoreMsDuration;
                        // durations in the subsequence are multiplied by durationFactor
                        subsequence.changeMessageTimestamps(durationFactor);
                    }
                    prevSubsequenceStartNow = now; // used only with the relative durations option
                }
                // if options.assistantUsesAbsoluteDurations === true, the durations will already be correct in all subsequences.
                subsequence.playSpan(outputDevice, 0, Number.MAX_VALUE, tracksControl, null, reportMsPosition);
            }

            function handleUnknownMessage(msg)
            {
                console.log("Unknown midi message, command:" + msg.command.toString() + ", data1:" + msg.data1.toString() + ", data2:" + msg.data2.toString());
            }

            // mcd contains message creation utilities ( see Main() )
            // controlData is one of the following objects (see jiAPControls.js):
            // { name: "channel pressure", statusHighNibble: 0xD0 },
            // { name: "pitch wheel", statusHighNibble: 0xE0 },
            // { name: "modulation (1)", midiControl: 1 },
            // { name: "volume (7)", midiControl: 7 },
            // { name: "pan (10)", midiControl: 10 },
            // { name: "expression (11)", midiControl: 11 },
            // { name: "timbre (71)", midiControl: 71 },
            // { name: "brightness (74)", midiControl: 74 },
            // { name: "effects (91)", midiControl: 91 },
            // { name: "tremolo (92)", midiControl: 92 },
            // { name: "chorus (93)", midiControl: 93 },
            // { name: "celeste (94)", midiControl: 94 },
            // { name: "phaser (95)", midiControl: 95 }
            // channel is the new message's channel
            // value is the new message's value
            function newControlMessage(mcd, controlData, channel, value)
            {
                var message;

                if (controlData.midiControl !== undefined)
                {
                    // a normal control
                    message = mcd.createMIDIMessage(mcd.CONTROL_CHANGE, controlData.midiControl, value, channel, 0);
                }
                else if (controlData.statusHighNibble !== undefined)
                {
                    // pitch-bend or channel pressure
                    if (controlData.statusHighNibble === mcd.PITCH_BEND)
                    {
                        message = mcd.createMIDIMessage(controlData.statusHighNibble, 0, value, channel, 0);
                    }
                    else if (controlData.statusHighNibble === mcd.CHANNEL_PRESSURE)
                    {
                        // ACHTUNG: The value goes to data1. Does this message work? Does Jazz send the right number of bytes?
                        message = mcd.createMIDIMessage(controlData.statusHighNibble, value, 0, channel, 0);
                    }
                    else
                    {
                        throw "Illegal controlData.";
                    }
                }
                else
                {
                    throw "Illegal controlData.";
                }

                return message;
            }

            function handleController(mcd, controlData, value, usesSoloTrack, usesOtherTracks)
            {
                var controlMessages = [], nControlMessages, i,
                    tracks = mainSequence.tracks, nTracks = tracks.length;

                if (usesSoloTrack && usesOtherTracks)
                {
                    for (i = 0; i < nTracks; ++i)
                    {
                        if (tracksControl.trackIsOn(i))
                        {
                            controlMessages.push(newControlMessage(mcd, controlData, i, value));
                        }
                    }
                }
                else if (usesSoloTrack)
                {
                    controlMessages.push(newControlMessage(mcd, controlData, options.livePerformersTrackIndex, value));
                }
                else if (usesOtherTracks)
                {
                    for (i = 0; i < nTracks; ++i)
                    {
                        if (tracksControl.trackIsOn(i) && i !== options.livePerformersTrackIndex)
                        {
                            controlMessages.push(newControlMessage(mcd, controlData, i, value));
                        }
                    }
                }
                else
                {
                    throw "Either usesSoloTrack or usesOtherTracks must be set here.";
                }

                nControlMessages = controlMessages.length;
                for (i = 0; i < nControlMessages; ++i)
                {
                    outputDevice.sendMIDIMessage(controlMessages[i]);
                }
            }

            function handleNoteOff(msg)
            {
                //console.log("NoteOff, pitch:", msg.data1.toString(), " velocity:", msg.data2.toString());

                if (msg.data1 === currentLivePerformersKeyPitch)
                {
                    silentlyCompleteCurrentlyPlayingSubsequence();
                    //stopCurrentlyPlayingSubsequence();
                    if (nextIndex < endIndex && subsequences[nextIndex].restSubsequence !== undefined)
                    {
                        currentIndex = nextIndex++;
                        playSubsequence(subsequences[currentIndex], options);
                    }
                    if (nextIndex === endIndex) // final barline
                    {
                        reportEndOfPerformance();
                    }
                    currentLivePerformersKeyPitch = -1;
                }
            }

            function handleNoteOn(mcd, inputMsg, overrideSoloPitch, overrideOtherTracksPitch, overrideSoloVelocity, overrideOtherTracksVelocity)
            {
                var subsequence;

                console.log("NoteOn, pitch:", inputMsg.data1.toString(), " velocity:", inputMsg.data2.toString());

                currentLivePerformersKeyPitch = inputMsg.data1;

                if (inputMsg.data2 > 0)
                {
                    silentlyCompleteCurrentlyPlayingSubsequence();
                    //stopCurrentlyPlayingSubsequence();

                    if (nextIndex === startIndex || subsequences[nextIndex].chordSubsequence !== undefined)
                    {
                        currentIndex = nextIndex++;
                        subsequence = subsequences[currentIndex];
                        if (overrideSoloPitch || overrideOtherTracksPitch || overrideSoloVelocity || overrideOtherTracksVelocity)
                        {
                            subsequence.overridePitchAndOrVelocity(mcd.NOTE_ON, options.livePerformersTrackIndex,
                                inputMsg.data1, inputMsg.data2,
                                overrideSoloPitch, overrideOtherTracksPitch, overrideSoloVelocity, overrideOtherTracksVelocity);
                        }
                        playSubsequence(subsequence, options);
                    }
                }
                else // velocity 0 is "noteOff"
                {
                    handleNoteOff(inputMsg);
                }
            }

            inputMsgType = getInputMessageType(msg);

            switch (inputMsgType)
            {
                case CHANNEL_PRESSURE: // EMU "aftertouch"
                    //console.log("Channel (=key) Pressure, value:", msg.data1.toString());
                    if (options.pressureSubstituteControlData !== null)
                    {
                        handleController(mcd, options.pressureSubstituteControlData, msg.data1, // ACHTUNG! data1 is correct!
                                                    options.usesPressureSolo, options.usesPressureOtherTracks);
                    }
                    break;
                case AFTERTOUCH: // EWI breath controller
                    //console.log("Aftertouch, value:", msg.data2.toString());
                    if (options.pressureSubstituteControlData !== null)
                    {
                        handleController(mcd, options.pressureSubstituteControlData, msg.data2,
                                                    options.usesPressureSolo, options.usesPressureOtherTracks);
                    }
                    break;
                case MODULATION_WHEEL: // EWI bite, EMU modulation wheel
                    //console.log("Modulation Wheel, value:", msg.data2.toString());
                    if (options.modSubstituteControlData !== null)
                    {
                        handleController(mcd, options.modSubstituteControlData, msg.data2,
                                                    options.usesModSolo, options.usesModOtherTracks);
                    }
                    break;
                case PITCH_WHEEL: // EWI pitch bend up/down controllers, EMU pitch wheel
                    //console.log("Pitch Wheel, value:", msg.data2.toString());
                    if (options.pitchBendSubstituteControlData !== null)
                    {
                        handleController(mcd, options.pitchBendSubstituteControlData, msg.data2,
                                                    options.usesPitchBendSolo, options.usesPitchBendOtherTracks);
                    }
                    break;
                case NOTE_ON:
                    handleNoteOn(mcd, msg,
                        options.overrideSoloPitch, options.overrideOtherTracksPitch,
                        options.overrideSoloVelocity, options.overrideOtherTracksVelocity);
                    break;
                case NOTE_OFF:
                    handleNoteOff(msg);
                    break;
                case END_OF_SEQUENCE:
                    stop();
                    break;
                case UNKNOWN:
                    handleUnknownMessage(msg);
                    break;
                case ILLEGAL_INDEX:
                    throw ("illegal index");
            }
        },

    // This function is called when options.assistedPerformance === true and the Go button is clicked (in the performance controls).
    // If options.assistedPerformance === false, sequence.playSpan(...) is called instead.
        playSpan = function (outDevice, fromMs, toMs, svgTracksControl)
        {
            function getIndex(subsequences, msPositionInScore)
            {
                var i = 0,
                    nSubsequences = subsequences.length,
                    subsequence = subsequences[0];

                while (i < nSubsequences && subsequence.msPositionInScore < msPositionInScore)
                {
                    i++;
                    subsequence = subsequences[i];
                }
                return i;
            }

            setState("running");
            outputDevice = outDevice;
            tracksControl = svgTracksControl;
            startIndex = getIndex(subsequences, fromMs);
            endIndex = getIndex(subsequences, toMs); // the index of the (unplayed) end chord or rest or endBarline
            currentIndex = -1;
            nextIndex = startIndex;
            prevSubsequenceStartNow = -1;
        },

    // creats an Assistant, complete with private subsequences
    // called when the Start button is clicked, and options.assistedPerformance === true
        Assistant = function (sequence, apControlOptions, reportEndOfWholePerformance, reportMillisecondPosition)
        {
            if (!(this instanceof Assistant))
            {
                return new Assistant(sequence, apControlOptions, reportEndOfWholePerformance, reportMillisecondPosition);
            }

            if (apControlOptions === undefined || apControlOptions.assistedPerformance !== true)
            {
                throw ("Error creating Assistant.");
            }

            options = apControlOptions;
            midiInHandler = handleMidiIn;

            setState("stopped");

            mainSequence = sequence;
            reportEndOfPerformance = reportEndOfWholePerformance;
            reportMsPosition = reportMillisecondPosition;

            makeSubsequences(options.livePerformersTrackIndex, sequence);

            // Starts an assisted performance 
            this.playSpan = playSpan;

            // Receives and handles incoming midi messages
            this.handleMidiIn = handleMidiIn;

            // these are called by the performance controls
            this.pause = pause; // pause()        
            this.resume = resume; // resume()
            this.stop = stop; // stop()

            this.isStopped = isStopped; // isStopped()
            this.isPaused = isPaused; // isPaused()
        },


        publicAPI =
        {
            init: init,
            // empty Assistant constructor
            Assistant: Assistant
        };
    // end var

    return publicAPI;

} (window));
