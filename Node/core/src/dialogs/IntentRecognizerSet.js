"use strict";
(function (RecognizeOrder) {
    RecognizeOrder[RecognizeOrder["parallel"] = 0] = "parallel";
    RecognizeOrder[RecognizeOrder["series"] = 1] = "series";
})(exports.RecognizeOrder || (exports.RecognizeOrder = {}));
var RecognizeOrder = exports.RecognizeOrder;
class IntentRecognizerSet {
    constructor(options = {}) {
        this.options = options;
        if (typeof this.options.intentThreshold !== 'number') {
            this.options.intentThreshold = 0.1;
        }
        if (!this.options.hasOwnProperty('recognizeOrder')) {
            this.options.recognizeOrder = RecognizeOrder.parallel;
        }
        if (!this.options.recognizers) {
            this.options.recognizers = [];
        }
        if (!this.options.processLimit) {
            this.options.processLimit = 4;
        }
        if (!this.options.hasOwnProperty('stopIfExactMatch')) {
            this.options.stopIfExactMatch = true;
        }
    }
    recognize(context, done) {
        if (this.options.recognizeOrder == RecognizeOrder.parallel) {
            this.recognizeInParallel(context, done);
        }
        else {
            this.recognizeInSeries(context, done);
        }
    }
    recognizer(plugin) {
        this.options.recognizers.push(plugin);
        return this;
    }
    recognizeInParallel(context, done) {
        var result = { score: 0.0, intent: null };
        async.eachLimit(this.options.recognizers, this.options.processLimit, (recognizer, cb) => {
            try {
                recognizer.recognize(context, (err, r) => {
                    if (!err && r && r.score > result.score && r.score >= this.options.intentThreshold) {
                        result = r;
                    }
                    cb(err);
                });
            }
            catch (e) {
                cb(e);
            }
        }, (err) => {
            if (!err) {
                done(null, result);
            }
            else {
                var msg = err.toString();
                done(err instanceof Error ? err : new Error(msg), null);
            }
        });
    }
    recognizeInSeries(context, done) {
        var i = 0;
        var result = { score: 0.0, intent: null };
        async.whilst(() => {
            return (i < this.options.recognizers.length && (result.score < 1.0 || !this.options.stopIfExactMatch));
        }, (cb) => {
            try {
                var recognizer = this.options.recognizers[i++];
                recognizer.recognize(context, (err, r) => {
                    if (!err && r && r.score > result.score && r.score >= this.options.intentThreshold) {
                        result = r;
                    }
                    cb(err);
                });
            }
            catch (e) {
                cb(e);
            }
        }, (err) => {
            if (!err) {
                done(null, result);
            }
            else {
                done(err instanceof Error ? err : new Error(err.toString()), null);
            }
        });
    }
}
exports.IntentRecognizerSet = IntentRecognizerSet;
//# sourceMappingURL=IntentRecognizerSet.js.map