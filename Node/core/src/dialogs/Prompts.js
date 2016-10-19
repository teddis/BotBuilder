"use strict";
const dlg = require('./Dialog');
const consts = require('../consts');
const entities = require('./EntityRecognizer');
const mb = require('../Message');
const Channel = require('../Channel');
const dl = require('../bots/Library');
const kb = require('../cards/Keyboard');
const ca = require('../cards/CardAction');
const logger = require('../logger');
(function (PromptType) {
    PromptType[PromptType["text"] = 0] = "text";
    PromptType[PromptType["number"] = 1] = "number";
    PromptType[PromptType["confirm"] = 2] = "confirm";
    PromptType[PromptType["choice"] = 3] = "choice";
    PromptType[PromptType["time"] = 4] = "time";
    PromptType[PromptType["attachment"] = 5] = "attachment";
})(exports.PromptType || (exports.PromptType = {}));
var PromptType = exports.PromptType;
(function (ListStyle) {
    ListStyle[ListStyle["none"] = 0] = "none";
    ListStyle[ListStyle["inline"] = 1] = "inline";
    ListStyle[ListStyle["list"] = 2] = "list";
    ListStyle[ListStyle["button"] = 3] = "button";
    ListStyle[ListStyle["auto"] = 4] = "auto";
})(exports.ListStyle || (exports.ListStyle = {}));
var ListStyle = exports.ListStyle;
class SimplePromptRecognizer {
    recognize(args, callback, session) {
        function findChoice(args, text) {
            var best = entities.EntityRecognizer.findBestMatch(args.enumValues, text);
            if (!best) {
                var n = entities.EntityRecognizer.parseNumber(text);
                if (!isNaN(n) && n > 0 && n <= args.enumValues.length) {
                    best = { index: n - 1, entity: args.enumValues[n - 1], score: 1.0 };
                }
            }
            return best;
        }
        var score = 0.0;
        var response;
        var text = args.utterance.trim();
        switch (args.promptType) {
            default:
            case PromptType.text:
                score = 0.5;
                response = text;
                break;
            case PromptType.number:
                var n = entities.EntityRecognizer.parseNumber(text);
                if (!isNaN(n)) {
                    var score = n.toString().length / text.length;
                    response = n;
                }
                break;
            case PromptType.confirm:
                var b = entities.EntityRecognizer.parseBoolean(text);
                if (typeof b !== 'boolean') {
                    var best = findChoice(args, text);
                    if (best) {
                        b = (best.index === 0);
                    }
                }
                if (typeof b == 'boolean') {
                    score = 1.0;
                    response = b;
                }
                break;
            case PromptType.time:
                var entity = entities.EntityRecognizer.recognizeTime(text, args.refDate ? new Date(args.refDate) : null);
                if (entity) {
                    score = entity.entity.length / text.length;
                    response = entity;
                }
                break;
            case PromptType.choice:
                var best = findChoice(args, text);
                if (best) {
                    score = best.score;
                    response = best;
                }
                break;
            case PromptType.attachment:
                if (args.attachments && args.attachments.length > 0) {
                    score = 1.0;
                    response = args.attachments;
                }
                break;
        }
        if (score > 0) {
            callback({ score: score, resumed: dlg.ResumeReason.completed, promptType: args.promptType, response: response });
        }
        else {
            callback({ score: score, resumed: dlg.ResumeReason.notCompleted, promptType: args.promptType });
        }
    }
}
exports.SimplePromptRecognizer = SimplePromptRecognizer;
class Prompts extends dlg.Dialog {
    begin(session, args) {
        args = args || {};
        args.promptAfterAction = args.hasOwnProperty('promptAfterAction') ? args.promptAfterAction : Prompts.options.promptAfterAction;
        args.retryCnt = 0;
        for (var key in args) {
            if (args.hasOwnProperty(key)) {
                session.dialogData[key] = args[key];
            }
        }
        this.sendPrompt(session, args);
    }
    replyReceived(session, result) {
        var args = session.dialogData;
        if (result.error || result.resumed == dlg.ResumeReason.completed) {
            result.promptType = args.promptType;
            session.endDialogWithResult(result);
        }
        else if (typeof args.maxRetries === 'number' && args.retryCnt >= args.maxRetries) {
            result.promptType = args.promptType;
            result.resumed = dlg.ResumeReason.notCompleted;
            session.endDialogWithResult(result);
        }
        else {
            args.retryCnt++;
            this.sendPrompt(session, args, true);
        }
    }
    dialogResumed(session, result) {
        var args = session.dialogData;
        if (args.promptAfterAction) {
            this.sendPrompt(session, args);
        }
    }
    recognize(context, cb) {
        var args = context.dialogData;
        Prompts.options.recognizer.recognize({
            promptType: args.promptType,
            utterance: context.message.text,
            locale: context.message.textLocale,
            attachments: context.message.attachments,
            enumValues: args.enumValues,
            refDate: args.refDate
        }, (result) => {
            if (result.error) {
                cb(result.error, null);
            }
            else {
                cb(null, result);
            }
        });
    }
    sendPrompt(session, args, retry = false) {
        logger.debug("prompts::sendPrompt called");
        if (retry && typeof args.retryPrompt === 'object' && !Array.isArray(args.retryPrompt)) {
            session.send(args.retryPrompt);
        }
        else if (typeof args.prompt === 'object' && !Array.isArray(args.prompt)) {
            session.send(args.prompt);
        }
        else {
            var style = ListStyle.none;
            if (args.promptType == PromptType.choice || args.promptType == PromptType.confirm) {
                style = args.listStyle;
                if (style == ListStyle.auto) {
                    if (Channel.supportsKeyboards(session, args.enumValues.length)) {
                        style = ListStyle.button;
                    }
                    else if (!retry && args.promptType == PromptType.choice) {
                        style = args.enumValues.length < 3 ? ListStyle.inline : ListStyle.list;
                    }
                    else {
                        style = ListStyle.none;
                    }
                }
            }
            var prompt;
            if (retry) {
                if (args.retryPrompt) {
                    prompt = mb.Message.randomPrompt(args.retryPrompt);
                }
                else {
                    var type = PromptType[args.promptType];
                    prompt = mb.Message.randomPrompt(Prompts.defaultRetryPrompt[type]);
                    args.localizationNamespace = consts.Library.system;
                    logger.debug("prompts::sendPrompt setting ns to %s", args.localizationNamespace);
                }
            }
            else {
                prompt = mb.Message.randomPrompt(args.prompt);
            }
            var locale = session.preferredLocale();
            prompt = session.localizer.gettext(locale, prompt, args.localizationNamespace);
            var connector = '';
            var list;
            var msg = new mb.Message();
            switch (style) {
                case ListStyle.button:
                    var buttons = [];
                    for (var i = 0; i < session.dialogData.enumValues.length; i++) {
                        var option = session.dialogData.enumValues[i];
                        buttons.push(ca.CardAction.imBack(session, option, option));
                    }
                    msg.text(prompt)
                        .attachments([new kb.Keyboard(session).buttons(buttons)]);
                    break;
                case ListStyle.inline:
                    list = ' (';
                    args.enumValues.forEach((v, index) => {
                        var value = v.toString();
                        list += connector + (index + 1) + '. ' + session.localizer.gettext(locale, value, consts.Library.system);
                        if (index == args.enumValues.length - 2) {
                            connector = index == 0 ? session.localizer.gettext(locale, "list_or", consts.Library.system) : session.localizer.gettext(locale, "list_or_more", consts.Library.system);
                        }
                        else {
                            connector = ', ';
                        }
                    });
                    list += ')';
                    msg.text(prompt + '%s', list);
                    break;
                case ListStyle.list:
                    list = '\n   ';
                    args.enumValues.forEach((v, index) => {
                        var value = v.toString();
                        list += connector + (index + 1) + '. ' + session.localizer.gettext(locale, value, args.localizationNamespace);
                        connector = '\n   ';
                    });
                    msg.text(prompt + '%s', list);
                    break;
                default:
                    msg.text(prompt);
                    break;
            }
            session.send(msg);
        }
        session.sendBatch();
    }
    static configure(options) {
        if (options) {
            for (var key in options) {
                if (options.hasOwnProperty(key)) {
                    Prompts.options[key] = options[key];
                }
            }
        }
    }
    static text(session, prompt, options) {
        var args = options || {};
        args.promptType = PromptType.text;
        args.prompt = prompt;
        beginPrompt(session, args);
    }
    static number(session, prompt, options) {
        var args = options || {};
        args.promptType = PromptType.number;
        args.prompt = prompt;
        beginPrompt(session, args);
    }
    static confirm(session, prompt, options) {
        var locale = session.preferredLocale();
        var args = options || {};
        args.promptType = PromptType.confirm;
        args.prompt = prompt;
        args.enumValues = [
            session.localizer.gettext(locale, 'confirm_yes', consts.Library.system),
            session.localizer.gettext(locale, 'confirm_no', consts.Library.system)
        ];
        args.listStyle = args.hasOwnProperty('listStyle') ? args.listStyle : ListStyle.auto;
        beginPrompt(session, args);
    }
    static choice(session, prompt, choices, options) {
        var args = options || {};
        args.promptType = PromptType.choice;
        args.prompt = prompt;
        args.listStyle = args.hasOwnProperty('listStyle') ? args.listStyle : ListStyle.auto;
        var c = entities.EntityRecognizer.expandChoices(choices);
        if (c.length == 0) {
            console.error("0 length choice for prompt:", prompt);
            throw "0 length choice list supplied";
        }
        args.enumValues = c;
        beginPrompt(session, args);
    }
    static time(session, prompt, options) {
        var args = options || {};
        args.promptType = PromptType.time;
        args.prompt = prompt;
        beginPrompt(session, args);
    }
    static attachment(session, prompt, options) {
        var args = options || {};
        args.promptType = PromptType.attachment;
        args.prompt = prompt;
        beginPrompt(session, args);
    }
}
Prompts.options = {
    recognizer: new SimplePromptRecognizer(),
    promptAfterAction: true
};
Prompts.defaultRetryPrompt = {
    text: "default_text",
    number: "default_number",
    confirm: "default_confirm",
    choice: "default_choice",
    time: "default_time",
    attachment: "default_file"
};
exports.Prompts = Prompts;
dl.systemLib.dialog(consts.DialogId.Prompts, new Prompts());
function beginPrompt(session, args) {
    if (typeof args.prompt == 'object' && args.prompt.toMessage) {
        args.prompt = args.prompt.toMessage();
    }
    if (typeof args.retryPrompt == 'object' && args.retryPrompt.toMessage) {
        args.retryPrompt = args.retryPrompt.toMessage();
    }
    session.beginDialog(consts.DialogId.Prompts, args);
}
//# sourceMappingURL=Prompts.js.map