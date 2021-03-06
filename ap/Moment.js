/*
 *  copyright 2012 James Ingram
 *  http://james-ingram-act-two.de/
 *
 *  Code licensed under MIT
 *  https://github.com/notator/assistant-performer/blob/master/License.md
 *
 *  ap/Moment.js
 *  The _AP.moment namespace which defines
 *
 *      // A read-only constant (-1), used by Moments
 *      UNDEFINED_TIMESTAMP
 *      
 *      // Moment constructor. Moments contain Messages, and are contained by Tracks.
 *      Moment(msPositionInChord)
 *                                
 *  Public Moment interface:
 *      
 *      // an array of temporally ordered Messages.
 *      messages
 *
 *      // the msPosition of the Moment in the score, relative to the beginning of its MidiChord.
 *      msPositionInChord;
 *      
 *      // The time at which the moment is actually sent. Initially UNDEFINED_TIMESTAMP.
 *      // Is set to absolute DOMHRT time in Sequence.nextMoment().
 *      timestamp;
 *
 *      // functions (defined on the prototype):
 *
 *      // appends the messages from another Moment, having the
 *      // same msPositionInChord, to the end of this Moment.
 *      mergeMoment(moment);
 */

/*jslint bitwise: false, nomen: true, plusplus: true, white: true */
/*global _AP: false,  window: false,  document: false, performance: false, console: false, alert: false, XMLHttpRequest: false */

_AP.namespace('_AP.moment');

_AP.moment = (function ()
{
    "use strict";

    var
    UNDEFINED_TIMESTAMP = -1,

    // Moment constructor
    // The moment.msPositionInChord is the (read only) position of the moment wrt its MidiChord in the score.
    // It is used to set moment.timestamp, taking the position of the MidiChord and the speed of performance into account,
    // when the absolute DOMHRT time is known. 
    Moment = function (msPositionInChord)
    {
        if (!(this instanceof Moment))
        {
            return new Moment(msPositionInChord);
        }

        if(msPositionInChord === undefined || msPositionInChord < UNDEFINED_TIMESTAMP)
        {
            throw "Error: Moment.msPositionInChord must be defined.";
        }

        Object.defineProperty(this, "msPositionInChord", { value: msPositionInChord, writable: false });

        // The absolute time (DOMHRT) at which this moment is sent to the output device.
        // This value is always set in Sequence.nextMoment().
        this.timestamp = UNDEFINED_TIMESTAMP;

        this.messages = []; // an array of Messages

        return this;
    },

    publicAPI =
    {
        UNDEFINED_TIMESTAMP: UNDEFINED_TIMESTAMP,
        // creates an empty Moment
        Moment: Moment
    };

    // Adds the moment2.messages to the end of the current messages using
    // msPositionInChord attributes to check synchronousness.
    // Sets restStart, chordStart if necessary.
    // Throws an exception if moment2.msPositionInChord !== this.msPositionInChord.
    Moment.prototype.mergeMoment = function (moment2)
    {
        var msPositionInChord = this.msPositionInChord;

        console.assert(msPositionInChord === moment2.msPositionInChord, "Attempt to merge moments having different msPositionInChord values.");

        if (moment2.chordStart !== undefined)
        {
            Object.defineProperty(this, "chordStart", { value: true, writable: false });
        }
        else if (moment2.restStart !== undefined)
        {
            Object.defineProperty(this, "restStart", { value: true, writable: false });
        }

        this.messages = this.messages.concat(moment2.messages);
    };

    // return a deep clone of this moment at a new msPositionReChord
    Moment.prototype.getCloneAtOffset = function(offset)
    {
        var
        i, originalMsg,
        msPositionReChord = this.msPositionInChord + offset,
        clone = new Moment(msPositionReChord);

        for(i = 0; i < this.messages.length; ++i)
        {
            originalMsg = this.messages[i];
            clone.messages.push(originalMsg.clone());
        }
        return clone;
    };

    return publicAPI;

} ());
