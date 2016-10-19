"use strict";
const actions = require('./DialogAction');
const consts = require('../consts');
const logger = require('../logger');
const Dialog_1 = require('./Dialog');
const IntentRecognizerSet_1 = require('./IntentRecognizerSet');
const RegExpRecognizer_1 = require('./RegExpRecognizer');
(function (RecognizeMode) {
    RecognizeMode[RecognizeMode["onBegin"] = 0] = "onBegin";
    RecognizeMode[RecognizeMode["onBeginIfRoot"] = 1] = "onBeginIfRoot";
    RecognizeMode[RecognizeMode["onReply"] = 2] = "onReply";
})(exports.RecognizeMode || (exports.RecognizeMode = {}));
var RecognizeMode = exports.RecognizeMode;
class IntentDialog extends Dialog_1.Dialog {
    constructor(options = {}) {
        super();
        this.handlers = {};
        this.recognizers = new IntentRecognizerSet_1.IntentRecognizerSet(options);
        this.recognizeMode = options.recognizeMode || RecognizeMode.onBeginIfRoot;
    }
    begin(session, args) {
        var mode = this.recognizeMode;
        var isRoot = (session.sessionState.callstack.length == 1);
        var recognize = (mode == RecognizeMode.onBegin || (isRoot && mode == RecognizeMode.onBeginIfRoot));
        if (this.beginDialog) {
            try {
                logger.info(session, 'IntentDialog.begin()');
                this.beginDialog(session, args, () => {
                    if (recognize) {
                        this.replyReceived(session);
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
    }
    replyReceived(session, recognizeResult) {
        if (!recognizeResult) {
            var locale = session.preferredLocale();
            this.recognize({ message: session.message, locale: locale, dialogData: session.dialogData, activeDialog: true }, (err, result) => {
                if (!err) {
                    this.invokeIntent(session, result);
                }
                else {
                    this.emitError(session, err);
                }
            });
        }
        else {
            this.invokeIntent(session, recognizeResult);
        }
    }
    dialogResumed(session, result) {
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
            super.dialogResumed(session, result);
        }
    }
    recognize(context, cb) {
        this.recognizers.recognize(context, cb);
    }
    onBegin(handler) {
        this.beginDialog = handler;
        return this;
    }
    matches(intent, dialogId, dialogArgs) {
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
    }
    matchesAny(intents, dialogId, dialogArgs) {
        for (var i = 0; i < intents.length; i++) {
            this.matches(intents[i], dialogId, dialogArgs);
        }
        return this;
    }
    onDefault(dialogId, dialogArgs) {
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
    }
    recognizer(plugin) {
        this.recognizers.recognizer(plugin);
        return this;
    }
    invokeIntent(session, recognizeResult) {
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
    }
    emitError(session, err) {
        var m = err.toString();
        err = err instanceof Error ? err : new Error(m);
        session.error(err);
    }
}
exports.IntentDialog = IntentDialog;
//# sourceMappingURL=IntentDialog.js.map