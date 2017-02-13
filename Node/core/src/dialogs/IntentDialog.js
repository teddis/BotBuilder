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
var actions = require('./DialogAction');
var consts = require('../consts');
var logger = require('../logger');
var Dialog_1 = require('./Dialog');
var IntentRecognizerSet_1 = require('./IntentRecognizerSet');
var RegExpRecognizer_1 = require('./RegExpRecognizer');
(function (RecognizeMode) {
    RecognizeMode[RecognizeMode["onBegin"] = 0] = "onBegin";
    RecognizeMode[RecognizeMode["onBeginIfRoot"] = 1] = "onBeginIfRoot";
    RecognizeMode[RecognizeMode["onReply"] = 2] = "onReply";
})(exports.RecognizeMode || (exports.RecognizeMode = {}));
var RecognizeMode = exports.RecognizeMode;
var IntentDialog = (function (_super) {
    __extends(IntentDialog, _super);
    function IntentDialog(options) {
        if (options === void 0) { options = {}; }
        _super.call(this);
        this.handlers = {};
        this.recognizers = new IntentRecognizerSet_1.IntentRecognizerSet(options);
        this.recognizeMode = options.recognizeMode || RecognizeMode.onBeginIfRoot;
    }
    IntentDialog.prototype.begin = function (session, args) {
        var _this = this;
        var mode = this.recognizeMode;
        var isRoot = (session.sessionState.callstack.length == 1);
        var recognize = (mode == RecognizeMode.onBegin || (isRoot && mode == RecognizeMode.onBeginIfRoot));
        if (this.beginDialog) {
            try {
                logger.info(session, 'IntentDialog.begin()');
                this.beginDialog(session, args, function () {
                    if (recognize) {
                        _this.replyReceived(session);
                    }
                });
            }
            catch (e) {
                this.emitError(session, e);
            }
        }
        else if (recognize) {
            this.replyReceived(session);
        }
    };
    IntentDialog.prototype.replyReceived = function (session, recognizeResult) {
        var _this = this;
        if (!recognizeResult) {
            var locale = session.preferredLocale();
            this.recognize({ message: session.message, locale: locale, dialogData: session.dialogData, activeDialog: true }, function (err, result) {
                if (!err) {
                    _this.invokeIntent(session, result);
                }
                else {
                    _this.emitError(session, err);
                }
            });
        }
        else {
            this.invokeIntent(session, recognizeResult);
        }
    };
    IntentDialog.prototype.dialogResumed = function (session, result) {
        var activeIntent = session.dialogData[consts.Data.Intent];
        if (activeIntent && this.handlers.hasOwnProperty(activeIntent)) {
            try {
                this.handlers[activeIntent](session, result);
            }
            catch (e) {
                this.emitError(session, e);
            }
        }
        else {
            _super.prototype.dialogResumed.call(this, session, result);
        }
    };
    IntentDialog.prototype.recognize = function (context, cb) {
        this.recognizers.recognize(context, cb);
    };
    IntentDialog.prototype.onBegin = function (handler) {
        this.beginDialog = handler;
        return this;
    };
    IntentDialog.prototype.matches = function (intent, dialogId, dialogArgs) {
        // Find ID and verify unique
        var id;
        if (intent) {
            if (typeof intent === 'string') {
                id = intent;
            }
            else {
                id = intent.toString();
                this.recognizers.recognizer(new RegExpRecognizer_1.RegExpRecognizer(id, intent));
            }
        }
        if (this.handlers.hasOwnProperty(id)) {
            throw new Error("A handler for '" + id + "' already exists.");
        }
        // Register handler
        if (Array.isArray(dialogId)) {
            this.handlers[id] = actions.waterfall(dialogId);
        }
        else if (typeof dialogId === 'string') {
            this.handlers[id] = actions.DialogAction.beginDialog(dialogId, dialogArgs);
        }
        else {
            this.handlers[id] = actions.waterfall([dialogId]);
        }
        return this;
    };
    IntentDialog.prototype.matchesAny = function (intents, dialogId, dialogArgs) {
        for (var i = 0; i < intents.length; i++) {
            this.matches(intents[i], dialogId, dialogArgs);
        }
        return this;
    };
    IntentDialog.prototype.onDefault = function (dialogId, dialogArgs) {
        // Register handler
        if (Array.isArray(dialogId)) {
            this.handlers[consts.Intents.Default] = actions.waterfall(dialogId);
        }
        else if (typeof dialogId === 'string') {
            this.handlers[consts.Intents.Default] = actions.DialogAction.beginDialog(dialogId, dialogArgs);
        }
        else {
            this.handlers[consts.Intents.Default] = actions.waterfall([dialogId]);
        }
        return this;
    };
    IntentDialog.prototype.recognizer = function (plugin) {
        // Append recognizer
        this.recognizers.recognizer(plugin);
        return this;
    };
    IntentDialog.prototype.invokeIntent = function (session, recognizeResult) {
        var activeIntent;
        if (recognizeResult.intent && this.handlers.hasOwnProperty(recognizeResult.intent)) {
            logger.info(session, 'IntentDialog.matches(%s)', recognizeResult.intent);
            activeIntent = recognizeResult.intent;
        }
        else if (this.handlers.hasOwnProperty(consts.Intents.Default)) {
            logger.info(session, 'IntentDialog.onDefault()');
            activeIntent = consts.Intents.Default;
        }
        if (activeIntent) {
            try {
                session.dialogData[consts.Data.Intent] = activeIntent;
                this.handlers[activeIntent](session, recognizeResult);
            }
            catch (e) {
                this.emitError(session, e);
            }
        }
        else {
            logger.warn(session, 'IntentDialog - no intent handler found for %s', recognizeResult.intent);
        }
    };
    IntentDialog.prototype.emitError = function (session, err) {
        var m = err.toString();
        err = err instanceof Error ? err : new Error(m);
        session.error(err);
    };
    return IntentDialog;
}(Dialog_1.Dialog));
exports.IntentDialog = IntentDialog;
