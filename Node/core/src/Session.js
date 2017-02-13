//
// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license.
//
// Microsoft Bot Framework: http://botframework.com
//
// Bot Builder SDK Github:
// https://github.com/Microsoft/BotBuilder
//
// Copyright (c) Microsoft Corporation
// All rights reserved.
//
// MIT License:
// Permission is hereby granted, free of charge, to any person obtaining
// a copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to
// permit persons to whom the Software is furnished to do so, subject to
// the following conditions:
//
// The above copyright notice and this permission notice shall be
// included in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED ""AS IS"", WITHOUT WARRANTY OF ANY KIND,
// EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
// NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
// LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
// OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
// WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
//
"use strict";
var __extends = (this && this.__extends) || function (d, b) {
    for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p];
    function __() { this.constructor = d; }
    d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
};
var dlg = require('./dialogs/Dialog');
var consts = require('./consts');
var sprintf = require('sprintf-js');
var events = require('events');
var msg = require('./Message');
var logger = require('./logger');
var async = require('async');
var Session = (function (_super) {
    __extends(Session, _super);
    function Session(options) {
        _super.call(this);
        this.options = options;
        this.msgSent = false;
        this._isReset = false;
        this.lastSendTime = new Date().getTime();
        this.batch = [];
        this.batchStarted = false;
        this.sendingBatch = false;
        this.inMiddleware = false;
        this._locale = null;
        this.localizer = null;
        this.library = options.library;
        this.localizer = options.localizer;
        if (typeof this.options.autoBatchDelay !== 'number') {
            this.options.autoBatchDelay = 250; // 250ms delay
        }
    }
    Session.prototype.dispatch = function (sessionState, message) {
        var _this = this;
        var index = 0;
        var session = this;
        var now = new Date().getTime();
        var middleware = this.options.middleware || [];
        var next = function () {
            var handler = index < middleware.length ? middleware[index] : null;
            if (handler) {
                index++;
                handler(session, next);
            }
            else {
                _this.inMiddleware = false;
                _this.sessionState.lastAccess = now; // Set after middleware runs so you can expire old sessions.
                _this.routeMessage();
            }
        };
        // Make sure dialogData is properly initialized
        this.sessionState = sessionState || { callstack: [], lastAccess: now, version: 0.0 };
        var cur = this.curDialog();
        if (cur) {
            this.dialogData = cur.state;
        }
        // Dispatch message
        this.inMiddleware = true;
        this.message = (message || { text: '' });
        if (!this.message.type) {
            this.message.type = consts.messageType;
        }
        // Ensure localized prompts are loaded
        var locale = this.preferredLocale();
        this.localizer.load(locale, function (err) {
            if (err) {
                _this.error(err);
            }
            else {
                next();
            }
        });
        return this;
    };
    Session.prototype.error = function (err) {
        logger.info(this, 'session.error()');
        // End conversation with a message
        if (this.options.dialogErrorMessage) {
            this.endConversation(this.options.dialogErrorMessage);
        }
        else {
            var locale = this.preferredLocale();
            this.endConversation(this.localizer.gettext(locale, 'default_error', consts.Library.system));
        }
        // Log error
        var m = err.toString();
        err = err instanceof Error ? err : new Error(m);
        this.emit('error', err);
        return this;
    };
    Session.prototype.preferredLocale = function (locale, callback) {
        if (locale) {
            this._locale = locale;
            if (this.userData) {
                this.userData[consts.Data.PreferredLocale] = locale;
            }
            if (this.localizer) {
                this.localizer.load(locale, callback);
            }
        }
        else if (!this._locale) {
            if (this.userData && this.userData[consts.Data.PreferredLocale]) {
                this._locale = this.userData[consts.Data.PreferredLocale];
            }
            else if (this.message && this.message.textLocale) {
                this._locale = this.message.textLocale;
            }
            else if (this.localizer) {
                this._locale = this.localizer.defaultLocale();
            }
        }
        return this._locale;
    };
    Session.prototype.gettext = function (messageid) {
        var args = [];
        for (var _i = 1; _i < arguments.length; _i++) {
            args[_i - 1] = arguments[_i];
        }
        return this.vgettext(messageid, args);
    };
    Session.prototype.ngettext = function (messageid, messageid_plural, count) {
        var tmpl;
        if (this.localizer && this.message) {
            tmpl = this.localizer.ngettext(this.message.textLocale || '', messageid, messageid_plural, count);
        }
        else if (count == 1) {
            tmpl = messageid;
        }
        else {
            tmpl = messageid_plural;
        }
        return sprintf.sprintf(tmpl, count);
    };
    Session.prototype.save = function () {
        logger.info(this, 'session.save()');
        this.startBatch();
        return this;
    };
    Session.prototype.send = function (message) {
        var args = [];
        for (var _i = 1; _i < arguments.length; _i++) {
            args[_i - 1] = arguments[_i];
        }
        this.msgSent = true;
        if (message) {
            var m;
            if (typeof message == 'string' || Array.isArray(message)) {
                m = this.createMessage(message, args);
            }
            else if (message.toMessage) {
                m = message.toMessage();
            }
            else {
                m = message;
            }
            this.prepareMessage(m);
            this.batch.push(m);
            logger.info(this, 'session.send()');
        }
        this.startBatch();
        return this;
    };
    Session.prototype.sendTyping = function () {
        this.msgSent = true;
        var m = { type: 'typing' };
        this.prepareMessage(m);
        this.batch.push(m);
        logger.info(this, 'session.sendTyping()');
        this.sendBatch();
        return this;
    };
    Session.prototype.messageSent = function () {
        return this.msgSent;
    };
    Session.prototype.beginDialog = function (id, args) {
        // Find dialog
        logger.info(this, 'session.beginDialog(%s)', id);
        var id = this.resolveDialogId(id);
        var dialog = this.findDialog(id);
        if (!dialog) {
            throw new Error('Dialog[' + id + '] not found.');
        }
        // Push dialog onto stack and start it
        // - Removed the call to save() here as an optimization. In the case of prompts
        //   we end up saving state twice, once here and again after they save off all of
        //   there params before sending the message.  This chnage does mean a dialog needs
        //   to either send a message or manually call session.save() when started but given
        //   most dialogs should always prompt the user is some way that seems reasonable and
        //   can save a number of intermediate calls to save.
        this.pushDialog({ id: id, state: {} });
        this.startBatch();
        dialog.begin(this, args);
        return this;
    };
    Session.prototype.replaceDialog = function (id, args) {
        // Find dialog
        logger.info(this, 'session.replaceDialog(%s)', id);
        var id = this.resolveDialogId(id);
        var dialog = this.findDialog(id);
        if (!dialog) {
            throw new Error('Dialog[' + id + '] not found.');
        }
        // Update the stack and start dialog
        this.popDialog();
        this.pushDialog({ id: id, state: {} });
        this.startBatch();
        dialog.begin(this, args);
        return this;
    };
    Session.prototype.endConversation = function (message) {
        var args = [];
        for (var _i = 1; _i < arguments.length; _i++) {
            args[_i - 1] = arguments[_i];
        }
        // Unpack message
        var m;
        if (message) {
            if (typeof message == 'string' || Array.isArray(message)) {
                m = this.createMessage(message, args);
            }
            else if (message.toMessage) {
                m = message.toMessage();
            }
            else {
                m = message;
            }
            this.msgSent = true;
            this.prepareMessage(m);
            this.batch.push(m);
        }
        // Clear private conversation data
        this.privateConversationData = {};
        // Clear stack and save.
        logger.info(this, 'session.endConversation()');
        var ss = this.sessionState;
        ss.callstack = [];
        this.sendBatch();
        return this;
    };
    Session.prototype.endDialog = function (message) {
        var args = [];
        for (var _i = 1; _i < arguments.length; _i++) {
            args[_i - 1] = arguments[_i];
        }
        // Check for result being passed
        if (typeof message === 'object' && (message.hasOwnProperty('response') || message.hasOwnProperty('resumed') || message.hasOwnProperty('error'))) {
            console.warn('Returning results via Session.endDialog() is deprecated. Use Session.endDialogWithResult() instead.');
            return this.endDialogWithResult(message);
        }
        // Validate callstack
        var cur = this.curDialog();
        if (cur) {
            // Unpack message
            var m;
            if (message) {
                if (typeof message == 'string' || Array.isArray(message)) {
                    m = this.createMessage(message, args);
                }
                else if (message.toMessage) {
                    m = message.toMessage();
                }
                else {
                    m = message;
                }
                this.msgSent = true;
                this.prepareMessage(m);
                this.batch.push(m);
            }
            // Pop dialog off the stack and then resume parent.
            logger.info(this, 'session.endDialog()');
            var childId = cur.id;
            cur = this.popDialog();
            this.startBatch();
            if (cur) {
                var dialog = this.findDialog(cur.id);
                if (dialog) {
                    dialog.dialogResumed(this, { resumed: dlg.ResumeReason.completed, response: true, childId: childId });
                }
                else {
                    // Bad dialog on the stack so just end it.
                    // - Because of the stack validation we should never actually get here.
                    this.error(new Error("Can't resume missing parent dialog '" + cur.id + "'."));
                }
            }
        }
        return this;
    };
    Session.prototype.endDialogWithResult = function (result) {
        // Validate callstack
        var cur = this.curDialog();
        if (cur) {
            // Validate result
            result = result || {};
            if (!result.hasOwnProperty('resumed')) {
                result.resumed = dlg.ResumeReason.completed;
            }
            result.childId = cur.id;
            // Pop dialog off the stack and resume parent dlg.
            logger.info(this, 'session.endDialogWithResult()');
            cur = this.popDialog();
            this.startBatch();
            if (cur) {
                var dialog = this.findDialog(cur.id);
                if (dialog) {
                    dialog.dialogResumed(this, result);
                }
                else {
                    // Bad dialog on the stack so just end it.
                    // - Because of the stack validation we should never actually get here.
                    this.error(new Error("Can't resume missing parent dialog '" + cur.id + "'."));
                }
            }
        }
        return this;
    };
    Session.prototype.cancelDialog = function (dialogId, replaceWithId, replaceWithArgs) {
        // Delete dialog(s)
        var childId = typeof dialogId === 'number' ? this.sessionState.callstack[dialogId].id : dialogId;
        var cur = this.deleteDialogs(dialogId);
        if (replaceWithId) {
            logger.info(this, 'session.cancelDialog(%s)', replaceWithId);
            var id = this.resolveDialogId(replaceWithId);
            var dialog = this.findDialog(id);
            this.pushDialog({ id: id, state: {} });
            this.startBatch();
            dialog.begin(this, replaceWithArgs);
        }
        else {
            logger.info(this, 'session.cancelDialog()');
            this.startBatch();
            if (cur) {
                var dialog = this.findDialog(cur.id);
                if (dialog) {
                    dialog.dialogResumed(this, { resumed: dlg.ResumeReason.canceled, response: null, childId: childId });
                }
                else {
                    // Bad dialog on the stack so just end it.
                    // - Because of the stack validation we should never actually get here.
                    this.error(new Error("Can't resume missing parent dialog '" + cur.id + "'."));
                }
            }
        }
        return this;
    };
    Session.prototype.reset = function (dialogId, dialogArgs) {
        logger.info(this, 'session.reset()');
        this._isReset = true;
        this.sessionState.callstack = [];
        if (!dialogId) {
            dialogId = this.options.dialogId;
            dialogArgs = this.options.dialogArgs;
        }
        this.beginDialog(dialogId, dialogArgs);
        return this;
    };
    Session.prototype.isReset = function () {
        return this._isReset;
    };
    Session.prototype.sendBatch = function (callback) {
        var _this = this;
        logger.info(this, 'session.sendBatch() sending %d messages', this.batch.length);
        if (this.sendingBatch) {
            return;
        }
        if (this.batchTimer) {
            clearTimeout(this.batchTimer);
            this.batchTimer = null;
        }
        this.batchTimer = null;
        var batch = this.batch;
        this.batch = [];
        this.batchStarted = false;
        this.sendingBatch = true;
        var cur = this.curDialog();
        if (cur) {
            cur.state = this.dialogData;
        }
        this.options.onSave(function (err) {
            if (!err) {
                if (batch.length) {
                    _this.options.onSend(batch, function (err) {
                        _this.sendingBatch = false;
                        if (_this.batchStarted) {
                            _this.startBatch();
                        }
                        if (callback) {
                            callback(err);
                        }
                    });
                }
                else {
                    _this.sendingBatch = false;
                    if (_this.batchStarted) {
                        _this.startBatch();
                    }
                    if (callback) {
                        callback(err);
                    }
                }
            }
            else {
                _this.sendingBatch = false;
                switch (err.code || '') {
                    case consts.Errors.EBADMSG:
                    case consts.Errors.EMSGSIZE:
                        // Something wrong with state so reset everything
                        _this.userData = {};
                        _this.batch = [];
                        _this.endConversation(_this.options.dialogErrorMessage || 'Oops. Something went wrong and we need to start over.');
                        break;
                }
                if (callback) {
                    callback(err);
                }
            }
        });
    };
    //-----------------------------------------------------
    // PRIVATE HELPERS
    //-----------------------------------------------------
    Session.prototype.startBatch = function () {
        var _this = this;
        this.batchStarted = true;
        if (!this.sendingBatch) {
            if (this.batchTimer) {
                clearTimeout(this.batchTimer);
            }
            this.batchTimer = setTimeout(function () {
                _this.sendBatch();
            }, this.options.autoBatchDelay);
        }
    };
    Session.prototype.createMessage = function (text, args) {
        args.unshift(text);
        var message = new msg.Message(this);
        msg.Message.prototype.text.apply(message, args);
        return message.toMessage();
    };
    Session.prototype.prepareMessage = function (msg) {
        if (!msg.type) {
            msg.type = 'message';
        }
        if (!msg.address) {
            msg.address = this.message.address;
        }
        if (!msg.textLocale && this.message.textLocale) {
            msg.textLocale = this.message.textLocale;
        }
    };
    Session.prototype.routeMessage = function () {
        var _this = this;
        var _that = this;
        function routeToDialog(recognizeResult) {
            var cur = _that.curDialog();
            if (!cur) {
                _that.beginDialog(_that.options.dialogId, _that.options.dialogArgs);
            }
            else {
                var dialog = _that.findDialog(cur.id);
                _that.dialogData = cur.state;
                dialog.replyReceived(_that, recognizeResult);
            }
        }
        // Validate callstack
        if (this.validateCallstack()) {
            // Check current dialogs confidence that it understands utterance
            this.recognizeCurDialog(function (err, dialogResult) {
                if (err) {
                    _this.error(err);
                }
                else if (dialogResult.score < 1.0) {
                    // Check the confidence of any actions on the callstack.
                    _this.recognizeCallstackActions(function (err, actionResult) {
                        if (err) {
                            _this.error(err);
                        }
                        else if (actionResult.score > dialogResult.score) {
                            // Route to action
                            if (actionResult.dialogId) {
                                // Action is on the stack
                                var dialog = _this.findDialog(actionResult.dialogId);
                                dialog.invokeAction(_this, actionResult);
                            }
                            else {
                                // Global action
                                _this.options.actions.invokeAction(_this, actionResult);
                            }
                        }
                        else {
                            routeToDialog(dialogResult);
                        }
                    });
                }
                else {
                    routeToDialog(dialogResult);
                }
            });
        }
        else {
            logger.warn(this, 'Callstack is invalid, resetting session.');
            this.reset(this.options.dialogId, this.options.dialogArgs);
        }
    };
    Session.prototype.recognizeCurDialog = function (done) {
        var cur = this.curDialog();
        if (cur && this.message.text.indexOf('action?') !== 0) {
            var dialog = this.findDialog(cur.id);
            var locale = this.preferredLocale();
            dialog.recognize({ message: this.message, locale: locale, dialogData: cur.state, activeDialog: true }, done);
        }
        else {
            done(null, { score: 0.0 });
        }
    };
    Session.prototype.recognizeCallstackActions = function (done) {
        var _this = this;
        var ss = this.sessionState;
        var i = ss.callstack.length - 1;
        var result = { score: 0.0 };
        async.whilst(function () {
            return (i >= 0 && result.score < 1.0);
        }, function (cb) {
            try {
                var index = i--;
                var cur = ss.callstack[index];
                var dialog = _this.findDialog(cur.id);
                dialog.recognizeAction(_this.message, function (err, r) {
                    if (!err && r && r._score > result.score) {
                        result = r;
                        result.dialogId = cur.id;
                        result.dialogIndex = index;
                    }
                    cb(err);
                });
            }
            catch (e) {
                cb(e);
            }
        }, function (err) {
            if (!err) {
                if (result.score < 1.0 && _this.options.actions) {
                    _this.options.actions.recognizeAction(_this.message, function (err, r) {
                        if (!err && r && r._score > result.score) {
                            result = r;
                        }
                        done(err, result);
                    });
                }
                else {
                    done(null, result);
                }
            }
            else {
                done(err instanceof Error ? err : new Error(err.toString()), null);
            }
        });
    };
    Session.prototype.vgettext = function (messageid, args) {
        var tmpl;
        if (this.localizer && this.message) {
            tmpl = this.localizer.gettext(this.preferredLocale() || this.message.textLocale || '', messageid);
        }
        else {
            tmpl = messageid;
        }
        return args && args.length > 0 ? sprintf.vsprintf(tmpl, args) : tmpl;
    };
    /** Checks for any unsupported dialogs on the callstack. */
    Session.prototype.validateCallstack = function () {
        var ss = this.sessionState;
        for (var i = 0; i < ss.callstack.length; i++) {
            var id = ss.callstack[i].id;
            if (!this.findDialog(id)) {
                return false;
            }
        }
        return true;
    };
    Session.prototype.resolveDialogId = function (id) {
        if (id.indexOf(':') >= 0) {
            return id;
        }
        var cur = this.curDialog();
        var libName = cur && !this.inMiddleware ? cur.id.split(':')[0] : consts.Library.default;
        return libName + ':' + id;
    };
    Session.prototype.findDialog = function (id) {
        var parts = id.split(':');
        return this.library.findDialog(parts[0] || consts.Library.default, parts[1]);
    };
    Session.prototype.pushDialog = function (ds) {
        var ss = this.sessionState;
        var cur = this.curDialog();
        if (cur) {
            cur.state = this.dialogData || {};
        }
        ss.callstack.push(ds);
        this.dialogData = ds.state || {};
        return ds;
    };
    Session.prototype.popDialog = function () {
        var ss = this.sessionState;
        if (ss.callstack.length > 0) {
            ss.callstack.pop();
        }
        var cur = this.curDialog();
        this.dialogData = cur ? cur.state : null;
        return cur;
    };
    Session.prototype.deleteDialogs = function (dialogId) {
        var ss = this.sessionState;
        var index = -1;
        if (typeof dialogId === 'string') {
            for (var i = ss.callstack.length - 1; i >= 0; i--) {
                if (ss.callstack[i].id == dialogId) {
                    index = i;
                    break;
                }
            }
        }
        else {
            index = dialogId;
        }
        if (index < 0 && index < ss.callstack.length) {
            throw new Error('Unable to cancel dialog. Dialog[' + dialogId + '] not found.');
        }
        ss.callstack.splice(index);
        var cur = this.curDialog();
        this.dialogData = cur ? cur.state : null;
        return cur;
    };
    Session.prototype.curDialog = function () {
        var cur;
        var ss = this.sessionState;
        if (ss.callstack.length > 0) {
            cur = ss.callstack[ss.callstack.length - 1];
        }
        return cur;
    };
    //-----------------------------------------------------
    // DEPRECATED METHODS
    //-----------------------------------------------------
    Session.prototype.getMessageReceived = function () {
        console.warn("Session.getMessageReceived() is deprecated. Use Session.message.sourceEvent instead.");
        return this.message.sourceEvent;
    };
    return Session;
}(events.EventEmitter));
exports.Session = Session;
