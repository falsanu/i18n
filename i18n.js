/**
 *   @module i18n
 *   @author Daniel Wetzel <daniel.wetzel@sevenval.com>
 *
 */
'use strict';

// dependencies and "private" vars

var path = require('path'),
  _ = require('underscore'),
  fs = require('fs'),
  async = require('async'),
  Jed = require('jed'),
  locale = require('locale'),
  po2json = require('po2json'),
  vsprintf = require('sprintf').vsprintf,
  debug = require('debug')('i18n:debug'),
  info = require('debug')('i18n:info'),
  warn = require('debug')('i18n:warn'),
  error = require('debug')('i18n:error');

//public exports
var I18n = function I18n (options) {

  var that = this;

  this.loadedLanguages = null;
  this.middlewareLocale = null;

  // Sets the default language
  this.defaultLocale = (typeof options.defaultLocale === 'string') ? options.defaultLocale : 'en';

  // stores information of each language
  this.languages = (typeof options.languages === 'object') ? options.languages : {};

  // stores the available language codes (en, de, en_US...)
  this.languageCodes = Object.keys(this.languages);

  // where are the PO-Files located
  this.pathToTranslations = (typeof options.pathToTranslations === 'string') ? options.pathToTranslations : path.join(process.cwd(), 'i18n');

  // stores loaded language locales
  this.loadedLanguages = {};

  // locale to use in middleware
  this.middlewareLocale = null;

  // setting custom logger functions
  this.logDebugFn = (typeof options.logDebugFn === 'function') ? options.logDebugFn : debug;
  this.logInfoFn = (typeof options.logInfoFn === 'function') ? options.logInfoFn : info;
  this.logWarnFn = (typeof options.logWarnFn === 'function') ? options.logWarnFn : warn;
  this.logErrorFn = (typeof options.logErrorFn === 'function') ? options.logErrorFn : error;

  if (this.languageCodes.length === 0) {
    this.logErrorFn('No languages defined, nothing to handle');
  }

  this.middleware = function i18nMiddleware(req, res, next) {

    // first, we need to create the locale instance
    if (!that.middlewareLocale) {
      that.middlewareLocale = locale(that.languageCodes);
    }

    return function (req, res, next) {

      // since locale works as a middleware, we use it as a middleware replacing the next with our own function
      that.middlewareLocale(req, res, function () {
        // after locale did its work we add the helper functions
        var language = req.locale;
        var locale = that.getLocaleForLanguage(language);
        res.locals.locale = locale;

        // inject translate helper to request
        req.tr = locale.__;
        req.__ = locale.__;
        req.trn = locale._n;
        req._n = locale._n;

        // inject translate helper during rendering
        var originalRender = res.render;
        res.render = function (view, options, callback) {
          if (callback === undefined && _.isFunction(options)) {
            callback = options;
            options = {};
          }

          var helpers = {
            tr: locale.__,
            __: locale.__,
            trn: locale._n,
            _n: locale._n
          };

          options = _.extend({}, options, {helpers: helpers});

          originalRender.bind(res)(view, options, callback);
        };

        next();
      });
    };
  };

  this.initialize = function (callback) {

    async.each(that.languageCodes, function (code, done) {

      var info = that.languages[code];
      if (info && info.name && info.plurals) {

        var file = path.join(that.pathToTranslations, code + '/LC_MESSAGES/messages.po');
        if (fs.existsSync(file)) {
          that.logInfoFn('Loading i18n for ' + info.name + ' from ' + file);
          that.loadLanguage(code, info, file, function (err) {
            done(err);
          });

        } else {
          var err = 'Could not locate language file ' + file;
          done(err);
        }
      } else {
        var _err = 'No plural information for ' + code;
        done(_err);
      }

    }, function (err) {

      if (err) {
        that.logErrorFn('Error loading i18n: ' + err);
      } else {
        that.logInfoFn('Finished loading i18n');
      }

      if (_.isFunction(callback)) {
        callback(err);
      }

    });
  };

  this.loadLanguage = function (code, plurals, poFile, callback) {

    po2json.parseFile(poFile, {format: 'jed'}, function (err, data) {
      if (err) {
        if (_.isFunction(callback)) {
          callback(new Error('Error parsing po file for ' + code + ': ' + err));
        }
      } else {

        data.locale_data.the_domain = {

          // The empty string key is used as the configuration
          // block for each domain
          '': {
            // Domain name
            'domain': 'mobile_web',

            // Language code
            'lang': code,

            // Plural form function for language
            'plural_forms': plurals
          }
        };

        var locale = new Jed(data);
        if (locale) {

          locale.code = code;
          that.loadedLanguages[code] = locale;

          // the first one is remembered as default locale
          if (!that.defaultLocale) {
            that.defaultLocale = locale;
          }

          // attaching the translation helpers
          /**
           * Translates a text.
           *
           * This function is only available in req environments (routes, views). The requested language is respected.
           *
           * @function tr
           * @param text {String} The string to translate.
           * @returns {String} The translated string.
           */
          locale.__ = function (text /*, args */) {
            var args = Array.prototype.slice.call(arguments).slice(0);
            if (args.length >= 2) {
              args[0] = null;
              args[args.length - 1] = null;
              args = _.compact(args);
            }

            var translated = null;
            if (locale) {
              translated = locale.translate(text).fetch(args);
            } else {

              try {
                translated = vsprintf(text, args);
              } catch (err) {
                that.logErrorFn(err);
                translated = text;
              }
            }
            return translated;
          };

          /**
           * Translates a text taking the number and plural forms into account.
           *
           * This function is only available in req environments (routes, views). The requested language is respected.
           *
           * @method trn
           * @param sText {String} The singular text to translate.
           * @param pText {String} The plural text to translate.
           * @param number {Number} The number.
           * @returns {String} The translated text in the correct form.
           */
          locale._n = function (sText, pText, number /*, args */) {
            var args = Array.prototype.slice.call(arguments).slice(0);
            if (args.length >= 4) {
              args[0] = null;
              args[1] = null;
              args[args.length - 1] = null;
              args = _.compact(args);
            }
            var translated = null;
            if (locale) {
              translated = locale.translate(sText).ifPlural(number, pText).fetch(args);
            } else {
              if (number === 1) {
                try {
                  translated = vsprintf(sText, args);
                } catch (err) {
                  that.logErrorFn(err);
                  translated = sText;
                }
              } else {
                try {
                  translated = vsprintf(pText, args);
                } catch (err) {
                  that.logErrorFn(err);
                  translated = pText;
                }
              }
            }
            return translated;
          };

          // finally, signal the callback
          if (_.isFunction(callback)) {
            that.logInfoFn('Loading Finished i18n for ' + code);
            callback();
          }
        } else {
          if (_.isFunction(callback)) {
            callback(new Error('Unknown error loading i18n for ' + code));
          }
        }

      }
    });
  };

  this.getLocaleForLanguage = function (code) {
    var locale = null;

    if (code && that.loadedLanguages[code]) {
      locale = that.loadedLanguages[code];
    }

    if (!locale) {
      locale = that.loadedLanguages[that.defaultLocale];
      that.logDebugFn('Using default locale "' + that.defaultLocale + '" because there is none matching the request\'s language "%s"', code);
    }

    return locale;
  };

};

module.exports = I18n;