"use strict";
const dlg = require('./dialogs/Dialog');
const consts = require('./consts');
const sprintf = require('sprintf-js');
const events = require('events');
const utils = require('./utils');
const answer = require('./workflow/AnswerAction');
const hangup = require('./workflow/HangupAction');
const reject = require('./workflow/RejectAction');
const playPrompt = require('./workflow/PlayPromptAction');
const prompt = require('./workflow/Prompt');
exports.CallState = {
    idle: 'idle',
    incoming: 'incoming',
    establishing: 'establishing',
    established: 'established',
    hold: 'hold',
    unhold: 'unhold',
    transferring: 'transferring',
    redirecting: 'redirecting',
    terminating: 'terminating',
    terminated: 'terminated'
};
exports.ModalityType = {
    audio: 'audio',
    video: 'video',
    videoBasedScreenSharing: 'videoBasedScreenSharing'
};
exports.NotificationType = {
    rosterUpdate: 'rosterUpdate',
    callStateChange: 'callStateChange'
};
exports.OperationOutcome = {
    success: 'success',
    failure: 'failure'
};
class CallSession extends events.EventEmitter {
    constructor(options) {
        super();
        this.options = options;
        this.msgSent = false;
        this._isReset = false;
        this.lastSendTime = new Date().getTime();
        this.actions = [];
        this.batchStarted = false;
        this.sendingBatch = false;
        this.library = options.library;
        this.promptDefaults = options.promptDefaults;
        this.recognizeDefaults = options.recognizeDefaults;
        this.recordDefaults = options.recordDefaults;
        if (typeof this.options.autoBatchDelay !== 'number') {
            this.options.autoBatchDelay = 250;
        }
    }
    dispatch(sessionState, message) {
        var index = 0;
        var middleware = this.options.middleware || [];
        var session = this;
        var next = () => {
            var handler = index < middleware.length ? middleware[index] : null;
            if (handler) {
                index++;
                handler(session, next);
            }
            else {
                this.routeMessage();
            }
        };
        this.sessionState = sessionState || { callstack: [], lastAccess: 0, version: 0.0 };
        this.sessionState.lastAccess = new Date().getTime();
        var cur = this.curDialog();
        if (cur) {
            this.dialogData = cur.state;
        }
        this.message = (message || {});
        this.address = utils.clone(this.message.address);
        next();
        return this;
    }
    error(err) {
        var msg = err.toString();
        err = err instanceof Error ? err : new Error(msg);
        this.endConversation(this.options.dialogErrorMessage || 'Oops. Something went wrong and we need to start over.');
        this.emit('error', err);
        return this;
    }
    gettext(messageid, ...args) {
        return this.vgettext(messageid, args);
    }
    ngettext(messageid, messageid_plural, count) {
        var tmpl;
        if (this.options.localizer && this.message) {
            tmpl = this.options.localizer.ngettext(this.message.user.locale || '', messageid, messageid_plural, count);
        }
        else if (count == 1) {
            tmpl = messageid;
        }
        else {
            tmpl = messageid_plural;
        }
        return sprintf.sprintf(tmpl, count);
    }
    save() {
        this.startBatch();
        return this;
    }
    answer() {
        this.msgSent = true;
        this.actions.push(new answer.AnswerAction(this).toAction());
        this.startBatch();
        return this;
    }
    reject() {
        this.msgSent = true;
        this.actions.push(new reject.RejectAction(this).toAction());
        this.startBatch();
        return this;
    }
    hangup() {
        this.msgSent = true;
        this.actions.push(new hangup.HangupAction(this).toAction());
        this.startBatch();
        return this;
    }
    send(action, ...args) {
        this.msgSent = true;
        if (action) {
            var a;
            if (typeof action == 'string' || Array.isArray(action)) {
                a = this.createPlayPromptAction(action, args);
            }
            else if (action.toAction) {
                a = action.toAction();
            }
            else {
                a = action;
            }
            this.actions.push(a);
        }
        this.startBatch();
        return this;
    }
    messageSent() {
        return this.msgSent;
    }
    beginDialog(id, args) {
        id = this.resolveDialogId(id);
        var dialog = this.findDialog(id);
        if (!dialog) {
            throw new Error('Dialog[' + id + '] not found.');
        }
        this.pushDialog({ id: id, state: {} });
        this.startBatch();
        dialog.begin(this, args);
        return this;
    }
    replaceDialog(id, args) {
        var id = this.resolveDialogId(id);
        var dialog = this.findDialog(id);
        if (!dialog) {
            throw new Error('Dialog[' + id + '] not found.');
        }
        this.popDialog();
        this.pushDialog({ id: id, state: {} });
        this.startBatch();
        dialog.begin(this, args);
        return this;
    }
    endConversation(action, ...args) {
        if (action) {
            var a;
            if (typeof action == 'string' || Array.isArray(action)) {
                a = this.createPlayPromptAction(action, args);
            }
            else if (action.toAction) {
                a = action.toAction();
            }
            else {
                a = action;
            }
            this.msgSent = true;
            this.actions.push(a);
        }
        this.privateConversationData = {};
        this.addCallControl(true);
        var ss = this.sessionState;
        ss.callstack = [];
        this.sendBatch();
        return this;
    }
    endDialog(action, ...args) {
        var cur = this.curDialog();
        if (!cur) {
            console.error('ERROR: Too many calls to session.endDialog().');
            return this;
        }
        if (action) {
            var a;
            if (typeof action == 'string' || Array.isArray(action)) {
                a = this.createPlayPromptAction(action, args);
            }
            else if (action.toAction) {
                a = action.toAction();
            }
            else {
                a = action;
            }
            this.msgSent = true;
            this.actions.push(a);
        }
        var childId = cur.id;
        cur = this.popDialog();
        this.startBatch();
        if (cur) {
            var dialog = this.findDialog(cur.id);
            if (dialog) {
                dialog.dialogResumed(this, { resumed: dlg.ResumeReason.completed, response: true, childId: childId });
            }
            else {
                this.error(new Error("ERROR: Can't resume missing parent dialog '" + cur.id + "'."));
            }
        }
        else {
            this.endConversation();
        }
        return this;
    }
    endDialogWithResult(result) {
        var cur = this.curDialog();
        if (!cur) {
            console.error('ERROR: Too many calls to session.endDialog().');
            return this;
        }
        result = result || {};
        if (!result.hasOwnProperty('resumed')) {
            result.resumed = dlg.ResumeReason.completed;
        }
        result.childId = cur.id;
        cur = this.popDialog();
        this.startBatch();
        if (cur) {
            var dialog = this.findDialog(cur.id);
            if (dialog) {
                dialog.dialogResumed(this, result);
            }
            else {
                this.error(new Error("ERROR: Can't resume missing parent dialog '" + cur.id + "'."));
            }
        }
        else {
            this.endConversation();
        }
        return this;
    }
    reset(dialogId, dialogArgs) {
        this._isReset = true;
        this.sessionState.callstack = [];
        if (!dialogId) {
            dialogId = this.options.dialogId;
            dialogArgs = this.options.dialogArgs;
        }
        this.beginDialog(dialogId, dialogArgs);
        return this;
    }
    isReset() {
        return this._isReset;
    }
    sendBatch() {
        if (this.sendingBatch) {
            return;
        }
        if (this.batchTimer) {
            clearTimeout(this.batchTimer);
            this.batchTimer = null;
        }
        this.batchStarted = false;
        this.sendingBatch = true;
        this.addCallControl(false);
        var workflow = {
            type: 'workflow',
            agent: consts.agent,
            source: this.address.channelId,
            address: this.address,
            actions: this.actions,
            notificationSubscriptions: ["callStateChange"]
        };
        this.actions = [];
        var cur = this.curDialog();
        if (cur) {
            cur.state = this.dialogData;
        }
        this.options.onSave((err) => {
            if (!err && workflow.actions.length) {
                this.options.onSend(workflow, (err) => {
                    this.sendingBatch = false;
                    if (this.batchStarted) {
                        this.startBatch();
                    }
                });
            }
            else {
                this.sendingBatch = false;
                if (this.batchStarted) {
                    this.startBatch();
                }
            }
        });
    }
    addCallControl(alsoEndCall) {
        var hasAnswer = (this.message.type !== 'conversation');
        var hasEndCall = false;
        var hasOtherActions = false;
        this.actions.forEach((a) => {
            switch (a.action) {
                case 'answer':
                    hasAnswer = true;
                    break;
                case 'hangup':
                case 'reject':
                    hasEndCall = true;
                    break;
                default:
                    hasOtherActions = true;
                    break;
            }
        });
        if (!hasAnswer && hasOtherActions) {
            this.actions.unshift(new answer.AnswerAction(this).toAction());
            hasAnswer = true;
        }
        if (alsoEndCall && !hasEndCall) {
            if (hasAnswer) {
                this.actions.push(new hangup.HangupAction(this).toAction());
            }
            else {
                this.actions.push(new reject.RejectAction(this).toAction());
            }
        }
    }
    startBatch() {
        this.batchStarted = true;
        if (!this.sendingBatch) {
            if (this.batchTimer) {
                clearTimeout(this.batchTimer);
            }
            this.batchTimer = setTimeout(() => {
                this.batchTimer = null;
                this.sendBatch();
            }, this.options.autoBatchDelay);
        }
    }
    createPlayPromptAction(text, args) {
        args.unshift(text);
        var p = new prompt.Prompt(this);
        prompt.Prompt.prototype.value.apply(p, args);
        return new playPrompt.PlayPromptAction(this).prompts([p]).toAction();
    }
    routeMessage() {
        try {
            var cur = this.curDialog();
            if (!cur) {
                this.beginDialog(this.options.dialogId, this.options.dialogArgs);
            }
            else if (this.validateCallstack()) {
                var dialog = this.findDialog(cur.id);
                this.dialogData = cur.state;
                dialog.replyReceived(this);
            }
            else {
                console.warn('Callstack is invalid, resetting session.');
                this.reset(this.options.dialogId, this.options.dialogArgs);
            }
        }
        catch (e) {
            this.error(e);
        }
    }
    vgettext(messageid, args) {
        var tmpl;
        if (this.options.localizer && this.message) {
            tmpl = this.options.localizer.gettext(this.message.user.locale || '', messageid);
        }
        else {
            tmpl = messageid;
        }
        return args && args.length > 0 ? sprintf.vsprintf(tmpl, args) : tmpl;
    }
    validateCallstack() {
        var ss = this.sessionState;
        for (var i = 0; i < ss.callstack.length; i++) {
            var id = ss.callstack[i].id;
            if (!this.findDialog(id)) {
                return false;
            }
        }
        return true;
    }
    resolveDialogId(id) {
        if (id.indexOf(':') >= 0) {
            return id;
        }
        var cur = this.curDialog();
        var libName = cur ? cur.id.split(':')[0] : consts.Library.default;
        return libName + ':' + id;
    }
    findDialog(id) {
        var parts = id.split(':');
        return this.library.findDialog(parts[0] || consts.Library.default, parts[1]);
    }
    pushDialog(dialog) {
        var ss = this.sessionState;
        var cur = this.curDialog();
        if (cur) {
            cur.state = this.dialogData || {};
        }
        ss.callstack.push(dialog);
        this.dialogData = dialog.state || {};
        return dialog;
    }
    popDialog() {
        var ss = this.sessionState;
        if (ss.callstack.length > 0) {
            ss.callstack.pop();
        }
        var cur = this.curDialog();
        this.dialogData = cur ? cur.state : null;
        return cur;
    }
    curDialog() {
        var cur;
        var ss = this.sessionState;
        if (ss.callstack.length > 0) {
            cur = ss.callstack[ss.callstack.length - 1];
        }
        return cur;
    }
}
exports.CallSession = CallSession;
//# sourceMappingURL=CallSession.js.map