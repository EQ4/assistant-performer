/*
*  Copyright 2012 James Ingram
*  http://james-ingram-act-two.de/
*
*  Code licensed under MIT
*  https://github.com/notator/assistant-performer/blob/master/License.md
*
*  midiLib/Sequence.js
*  The MIDILib.sequence namespace which defines the
*
*       // The new sequence contains nTracks empty tracks.
*       Sequence(nTracks) sequence constructor. 
*
*  Public Interface (See longer descriptions in the code.):
*
*       // an array of Tracks
*       tracks 
*
*       // functions (defined on the prototype):
*
*           // Start playing (part of) the Sequence.
*           // Arguments:
*           // midiOutdevice: the MIDI output device
*           // fromMsPositionInScore, toMsPositionInScore: the part of the sequence to play 
*           //      (not including toMsPositionInScore)
*           // trackIsOnArray[trackIndex] returns a boolean which determines whether the track will
*           //       be played or not. This array is read only.
*           // [optional] recording: a sequence in which the performed messages will be recorded.
*           // [optional] reportEndOfSpanCallback: called when the performance ends.
*           // [optional] reportMsPositionInScoreCallback: called whenever a cursor needs to be updated
*           //       in the score.
*           //  The optional arguments can either be missing or null.
*           playSpan(midiOutDevice, fromMsPositionInScore, toMsPositionInScore, trackIsOnArray,
*                    recording, reportEndOfSpanCallback, reportMsPositionInScoreCallback)
*       
*           // pause a running performance
*           pause(),
*       
*           // resume a paused performance
*           resume()
*       
*           // stop a running performance
*           stop()
*       
*           // Is the performance stopped?
*           isStopped()
*       
*           // Is the performance paused?
*           isPaused()
*       
*           // Is the performance running?
*           isRunning()
*
*           // When called on a running sequence, immediately sends all its
*           // unsent messages except noteOns, and then calls stop().
*           // The sent messages are not recorded.
*           finishSilently: finishSilently
*/

/*jslint bitwise: false, nomen: false, plusplus: true, white: true */


MIDILib.namespace('MIDILib.sequence');

MIDILib.sequence = (function (window)
{
    "use strict";
    var
    UNDEFINED_TIMESTAMP = MIDILib.moment.UNDEFINED_TIMESTAMP,
    CMD = MIDILib.constants.COMMAND,
    Track = MIDILib.track.Track,

    // An empty sequence is created. It contains an empty array of MIDILib.track.Tracks.
    Sequence = function (nTracks)
    {
        var i;
        if (!(this instanceof Sequence))
        {
            return new Sequence(nTracks);
        }

        this.tracks = []; // an array of Tracks
        for (i = 0; i < nTracks; ++i)
        {
            this.tracks.push(new Track());
        }
    },

    publicSequenceAPI =
    {
        // creates an empty sequence
        Sequence: Sequence
    };
    // end var

    Sequence.prototype = (function (window)
    {
        var
        // used by setState()
        currentMoment = null, // nextMoment(), resume(), tick()
        pausedMoment = null, // set by pause(), used by resume()
        stopped = true, // nextMoment(), stop(), pause(), resume(), isStopped()
        paused = false, // nextMoment(), pause(), isPaused()

        that, // closure variable set by playSpan(), used by nextMoment()

        maxDeviation, // for console.log, set to 0 when performance starts
        midiOutputDevice, // set in playSpan(), used by tick()
        reportEndOfSpan, // callback. Can be null or undefined. Set in playSpan().
        reportMsPositionInScore,  // callback. Can be null or undefined. Set in playSpan().
        lastReportedMsPosition = -1, // set by tick() used by nextMoment()
        msPositionToReport = -1,   // set in nextMoment() and used/reset by tick()

        sequenceStartTime = -1,  // set in playSpan(), used by stop(), runFrom()

        recordingSequence, // the sequence being recorded. set in playSpan() and resume(), used by tick()

        setState = function (state)
        {
            switch (state)
            {
                case "stopped":
                    stopped = true;
                    paused = false;
                    pausedMoment = null;
                    break;
                case "paused":
                    stopped = false;
                    paused = true;
                    pausedMoment = currentMoment;
                    break;
                case "running":
                    stopped = false;
                    paused = false;
                    pausedMoment = null;
                    break;
                default:
                    throw "Unknown sequence state!";
            }
        },

        isStopped = function ()
        {
            return (stopped === true && paused === false);
        },

        isPaused = function ()
        {
            return (stopped === false && paused === true);
        },

        isRunning = function ()
        {
            return (stopped === false && paused === false);
        },

        // Should only be called while running
        pause = function ()
        {
            if (isRunning())
            {
                setState("paused");
            }
            else
            {
                throw "Attempt to pause a stopped or paused sequence.";
            }
        },

        // does nothing if the sequence is already stopped
        stop = function ()
        {
            var performanceMsDuration;

            if (!isStopped())
            {
                performanceMsDuration = Math.ceil(window.performance.now() - sequenceStartTime);
                currentMoment = null;
                setState("stopped");
                if (reportEndOfSpan !== undefined && reportEndOfSpan !== null)
                {
                    reportEndOfSpan(recordingSequence, performanceMsDuration);
                }
            }
        },

        // If the time relative to the sequence has been adjusted (as currently in an assisted
        // performances that uses the 'relative durations' option), this function returns the
        // adjusted time. Otherwise it returns this.msPositionInScore (which takes account of
        // the global speed option).
        timeReSequence = function (moment)
        {
            var time;

            if (moment.adjustedTimeReSequence === UNDEFINED_TIMESTAMP)
            {
                time = moment.msPositionInScore;
            }
            else
            {
                time = moment.adjustedTimeReSequence;
            }
            return time;
        },

        // used by tick(), resume(), playSpan(), finishSilently()
        // Returns either the next moment in the sequence, or null.
        // Null is returned if there are no more moments or if the sequence is paused or stopped.
        // The next moment in the sequence is the earliest moment indexed by any of the
        // track.currentIndex indices, or null if track.currentIndex > track.toIndex in all tracks.
        nextMoment = function ()
        {
            var
            the = that, // that is set in playSpan(). Maybe using a local variable is faster...
            nTracks = the.tracks.length,
            track, i, currentTrack,
            moment, minMsPositionInScore = Number.MAX_VALUE,
            nextMomt = null;

            if (!stopped && !paused)
            {
                // first find nextMomentTrackIndex
                for (i = 0; i < nTracks; ++i)
                {
                    track = the.tracks[i];
                    if (track.isPerforming && track.currentIndex < track.toIndex)
                    {
                        moment = track.moments[track.currentIndex];
                        if (moment.msPositionInScore < minMsPositionInScore)
                        {
                            currentTrack = track;
                            nextMomt = moment;
                            minMsPositionInScore = moment.msPositionInScore;
                        }
                    }
                }

                // nextMomt is now either null (= end of span) or the next moment.

                if (nextMomt === null)
                {
                    stop(); // calls reportEndOfSpan()
                }
                else
                {
                    //console.log("currentIndex=" + currentTrack.currentIndex +
                    //            "toIndex=" + currentTrack.toIndex +
                    //            "totalMoments=" + currentTrack.moments.length);
                    currentTrack.currentIndex++;

                    if (reportMsPositionInScore !== undefined && reportMsPositionInScore !== null
                    && (nextMomt.chordStart || nextMomt.restStart) // These attributes are set when loading a score.
                    && (nextMomt.msPositionInScore > lastReportedMsPosition))
                    {
                        // the position will be reported by tick() when nextMomt is sent.
                        msPositionToReport = nextMomt.msPositionInScore;
                    }

                    nextMomt.timestamp = timeReSequence(nextMomt) + sequenceStartTime;
                }
            }

            return nextMomt; // null stops tick().
        },

        // tick() function -- which ws a lot to Chris Wilson of the Web Audio Group
        // Recursive function. Also used by resume(), playSpan()
        // This function has been tested as far as possible without having "a conformant outputDevice.send() with timestamps".
        // It needs testing again with the conformant outputDevice.send() and a higher value for PREQUEUE. What would the
        // ideal value for PREQUEUE be? 
        // Email correspondence with Chris Wilson (End of Oct. 2012):
        //      James: "...how do I decide how big PREQUEUE should be?"
        //      Chris: "Well, you're trading off two things:
        //          - 'precision' of visual display (though keep in mind that is fundamentally limited to the 16.67ms tick
        //            of the visual refresh rate (for a 60Hz display) - and that also affects how quickly you can respond
        //            to tempo changes (or stopping/pausing playback).
        //          - reliance on how accurate the setTimeout/setInterval clock is (for that reason alone, the lookahead
        //            probably needs to be >5ms).
        //          So, in short, you'll just have to test on your target systems."
        //      James: "Yes, that's more or less what I thought. I'll start testing with PREQUEUE at 16.67ms."
        //
        // 16th Nov. 2012: The cursor can only be updated once per tick, so PREQUEUE needs to be small enough for that not
        // to matter.
        // 18th Jan. 2013 -- Jazz 1.2 does not support timestamps.
        //
        // The following variables are initialised in playSpan() to start playing the span:
        //      currentMoment // the first moment in the sequence
        //      track attributes:
        //          isPerforming // set by referring to the track control
        //          fromIndex // the index of the first moment in the track to play
        //          toIndex // the index of the final moment in the track (which does not play)
        //          currentIndex // = fromIndex
        //      maxDeviation = 0; // just for console.log
        //      midiOutputDevice // the midi output device
        //      reportEndOfSpan // can be null
        //      reportMsPosition // can be null    
        tick = function ()
        {
            var
            deviation,
            PREQUEUE = 0, // needs to be set to a larger value later. See above.
            now = window.performance.now(),
            delay;

            // moment.timestamps are always absolute DOMHRT values here.
            // (Chris said that the timestamp should be absolute DOMHRT time when the moment is sent.)
            // Note that Jazz 1.2 does not support timestamps. It always sends Messages immediately.
            function sendMessages(moment)
            {
                var
                messages = moment.messages,
                i, nMessages = messages.length, timestamp = moment.timestamp;

                for (i = 0; i < nMessages; ++i)
                {
                    midiOutputDevice.send(messages[i].data, timestamp);
                }
            }

            if (currentMoment === null)
            {
                //console.log("Pause, or end of sequence.  maxDeviation is " + maxDeviation + "ms");
                return;
            }

            delay = currentMoment.timestamp - now; // compensates for inaccuracies in setTimeout
            //console.log("tick: delay1 = " + delay);
            //console.log("currentMoment.msPositionInScore: " + currentMoment.msPositionInScore);
            //console.log("currentMoment.timestamp: " + currentMoment.timestamp);
            // send all messages that are due between now and PREQUEUE ms later. 
            while (delay <= PREQUEUE)
            {
                // these values are only used by console.log (See end of file too!)
                deviation = (now - currentMoment.timestamp);
                maxDeviation = (deviation > maxDeviation) ? deviation : maxDeviation;
                //console.log("deviation: " + deviation + "ms");

                if (msPositionToReport > 0)
                {
                    reportMsPositionInScore(msPositionToReport);
                    lastReportedMsPosition = msPositionToReport; // lastReportedMsPosition is used in nextMoment() above.
                    msPositionToReport = -1;
                }

                if (currentMoment.messages.length > 0) // rest moments can be empty (but should be reported above) 
                {
                    sendMessages(currentMoment);

                    if (recordingSequence !== undefined && recordingSequence !== null)
                    {
                        // The moments are recorded with their current (absolute DOMHRT) timestamp values.
                        // These values are adjusted relative to the first moment.timestamp
                        // before saving them in a Standard MIDI File.
                        // (i.e. the value of the earliest timestamp in the recording is
                        // subtracted from all the timestamps in the recording) 
                        recordingSequence.tracks[currentMoment.messages[0].channel()].addLiveScoreMoment(currentMoment);
                    }
                }

                currentMoment = nextMoment();

                if (currentMoment === null)
                {
                    // we're pausing, or have hit the end of the sequence.
                    //console.log("Pause, or end of sequence.  maxDeviation: " + maxDeviation + "ms");
                    return;
                }

                delay = currentMoment.timestamp - now;

                //console.log("tick: delay2 = " + delay + "(PREQUEUE: " + PREQUEUE + ")");
            }

            //console.log("tick: delay3 = " + delay);
            window.setTimeout(tick, delay);  // that will schedule the next tick.
        },

        // Should only be called when the sequence is stopped or paused.
        runFrom = function (moment, now)
        {
            if (isStopped() || isPaused())
            {
                setState("running");

                sequenceStartTime = now - timeReSequence(moment);

                currentMoment = nextMoment();
                if (currentMoment === null)
                {
                    return;
                }
                tick();
            }
            else
            {
                throw "Error: runFrom() should only be called when the sequence is stopped or paused.";
            }
        },

        // Should only be called when this sequence is paused and pausedMoment is not null.
        resume = function ()
        {
            if (isPaused())
            {
                runFrom(pausedMoment, window.performance.now());
            }
            else
            {
                throw "Error: resume() should only be called when this sequence is paused.";
            }
        },

        // playSpan();
        // Note that the final Moment (at toMsPositionInScore) is often at the final barline
        // (which may or may not contain noteOff Messages).
        //
        // trackIsOnArray[trackIndex] returns a boolean which determines whether the track will
        // be played or not. This array belongs to its creator, and is read only.
        //
        // recording is a Sequence to which timestamped moments are added as they are performed.
        // Can be undefined or null. If used, it should be an empty Sequence having the same number
        // of tracks as this (calling) sequence.
        //
        // The reportEndOfSpanCallback argument is a callback function which is called when the
        // performance stops -- either because the end of the span has been reached, or when the
        // user stops the performance prematurely. Can be undefined or null.
        // It is called here as:
        //      reportEndOfSpan(recordingSequence, performanceMsDuration);
        // The arguments are a Sequence containing a recording of the (timestamped) messages
        // which have been sent, and the total duration of the performance (in milliseconds). 
        //
        // The reportMsPositionInScoreCallback argument is a callback function which reports
        // the current msPositionInScore back to the GUI while performing. Can be undefined or null.
        // It is called here as:
        //      reportMsPositionInScore(msPositionToReport);
        // The msPosition it passes back is the original number of milliseconds from the start of
        // the score (taking the global speed option into account). This value is used to identify
        // chord and rest symbols in the score, and so to synchronize the running cursor.
        // Moments whose msPositionInScore is to be reported are given chordStart or restStart
        // attributes before playSpan() is called.
        playSpan = function (midiOutDevice, fromMsPositionInScore, toMsPositionInScore, trackIsOnArray,
                                recording, reportEndOfSpanCallback, reportMsPositionInScoreCallback)
        {
            var firstMomentInThisSequence;

            // Sets each track's isPerforming attribute. If the track is performing,
            // its fromIndex, currentIndex and toIndex attributes are also set.
            // Sets each performing track to contain all the moments between msOffsetFromStartOfScore
            // and toMsPositionInScore inclusive.
            // Note that the final Moment can be at the final barline (a restStart).
            function setTrackAttributes(tracks, trackIsOnArray, msOffsetFromStartOfScore, toMsPositionInScore)
            {
                var
                i, nTracks = tracks.length, track,
                j, trackMoments, trackLength;

                for (i = 0; i < nTracks; ++i)
                {
                    track = tracks[i];
                    trackMoments = track.moments;
                    trackLength = trackMoments.length;

                    // trackLength can be 0, if nothing happens during
                    // the track (maybe during a during a subsequence)
                    if (trackLength === 0)
                    {
                        track.isPerforming = false;
                    }
                    else
                    {
                        track.isPerforming = trackIsOnArray[i];
                    }

                    if (track.isPerforming) // trackLength is > 0
                    {
                        for (j = 0; j < trackLength; ++j)
                        {
                            if (trackMoments[j].msPositionInScore >= msOffsetFromStartOfScore)
                            {
                                track.fromIndex = j;
                                break;
                            }
                        }
                        for (j = track.fromIndex; j < trackLength; ++j)
                        {
                            // The track's final position can be the position of the final barline.
                            // The moment at trackMoments[track.toIndex] is never performed as part of this sequence.
                            if (trackMoments[j].msPositionInScore < toMsPositionInScore)
                            {
                                track.toIndex = j + 1;
                            }
                            else
                            {
                                break;
                            }
                        }

                        track.currentIndex = track.fromIndex;
                    }
                }
            }

            // Returns the first moment that will be performed in this sequence
            function getFirstMomentInThisSequence(tracks)
            {
                var 
                i, nTracks = tracks.length, track, moment, msPosition,
                firstMoment = null, firstPosition = Number.MAX_VALUE;

                for (i = 0; i < nTracks; ++i)
                {
                    track = tracks[i];
                    if (track.isPerforming)
                    {
                        moment = track.moments[track.fromIndex];
                        msPosition = moment.msPositionInScore;
                        if (msPosition < firstPosition)
                        {
                            firstMoment = moment;
                            firstPosition = msPosition;
                        }
                    }
                }

                if (firstMoment === null)
                {
                    throw "Error: at least one track must be performing.";
                }

                return firstMoment;
            }

            that = this;

            stop(); //  sets state to "stopped" if it isn't already.

            recordingSequence = recording; // can be undefined or null

            if (midiOutDevice === undefined || midiOutDevice === null)
            {
                throw "The midi output device must be defined.";
            }

            midiOutputDevice = midiOutDevice;
            reportEndOfSpan = reportEndOfSpanCallback; // can be null or undefined
            reportMsPositionInScore = reportMsPositionInScoreCallback; // can be null or undefined

            lastReportedMsPosition = -1;

            maxDeviation = 0; // for console.log

            setTrackAttributes(that.tracks, trackIsOnArray, fromMsPositionInScore, toMsPositionInScore);

            sequenceStartTime = window.performance.now();
            firstMomentInThisSequence = getFirstMomentInThisSequence(that.tracks);
            runFrom(firstMomentInThisSequence, sequenceStartTime);
        },

        // When called, immediately sends all the sequence's unsent messages, except noteOns,
        // and then calls stop(). The sent messages are not recorded.
        finishSilently = function ()
        {
            var
            i, nMessages, messages, message,
            moment = nextMoment(),
            now = window.performance.now();

            while (moment !== null)
            {
                nMessages = moment.messages.length;
                messages = moment.messages;
                for (i = 0; i < nMessages; ++i)
                {
                    message = messages[i];
                    if (!(message.command() === CMD.NOTE_ON && message.data[2] > 0))
                    {
                        midiOutputDevice.send(message.data, now);
                    }
                }
                moment = nextMoment();
            }
            stop();
        },

        publicPrototypeAPI =
        {
            playSpan: playSpan,
            pause: pause,
            resume: resume,
            stop: stop,
            isStopped: isStopped,
            isPaused: isPaused,
            isRunning: isRunning,
            finishSilently: finishSilently
        };

        return publicPrototypeAPI;

    } (window));

    return publicSequenceAPI;

} (window));


