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
  error = require('debug')('i18n:error'),
  defaultLocale, languages, pathToTranslations, languageCodes, loadedLanguages, middlewareLocale, logDebugFn, logInfoFn, logWarnFn, logErrorFn;

//public exports
var i18n = exports;

i18n.configure = function i18nConfigure(options) {

  // Sets the default language
  defaultLocale = (typeof options.defaultLocale === 'string') ? options.defaultLocale : 'en';

  // stores information of each language
  languages = (typeof options.languages === 'object') ? options.languages : {};

  // stores the available language codes (en, de, en_US...)
  languageCodes = Object.keys(languages);

  // where are the PO-Files located
  pathToTranslations = (typeof options.pathToTranslations === 'string') ? options.pathToTranslations : path.join(process.cwd(), 'i18n');

  // stores loaded language locales
  loadedLanguages = {};

  // locale to use in middleware
  middlewareLocale = null;

  // setting custom logger functions
  logDebugFn = (typeof options.logDebugFn === 'function') ? options.logDebugFn : debug;
  logInfoFn = (typeof options.logInfoFn === 'function') ? options.logInfoFn : info;
  logWarnFn = (typeof options.logWarnFn === 'function') ? options.logWarnFn : warn;
  logErrorFn = (typeof options.logErrorFn === 'function') ? options.logErrorFn : error;

  if (languageCodes.length === 0) {
    logError('No languages defined, nothing to handle');
  }

};


i18n.middleware = function i18nMiddleware(req, res, next) {

  // first, we need to create the locale instance
  if (!middlewareLocale) {
    middlewareLocale = locale(languageCodes);
  }

  return function (req, res, next) {

    // since locale works as a middleware, we use it as a middleware replacing the next with our own function
    middlewareLocale(req, res, function () {
      // after locale did its work we add the helper functions
      var language = req.locale;
      var locale = i18n.getLocaleForLanguage(language);
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
}



i18n.initialize = function (callback) {

  async.each(languageCodes, function (code, done) {

    var info = languages[code];
    if (info && info.name && info.plurals) {

      var file = path.join(pathToTranslations, code + '/LC_MESSAGES/messages.po');
      if (fs.existsSync(file)) {
        logInfoFn('Loading i18n for ' + info.name + ' from ' + file);
        i18n.loadLanguage(code, info, file, function (err) {
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
      logError('Error loading i18n: ' + err);
    } else {
      logInfoFn('Finished loading i18n');
    }

    if (_.isFunction(callback)) {
      callback(err);
    }

  });
};

i18n.loadLanguage = function (code, plurals, poFile, callback) {

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
        loadedLanguages[code] = locale;

        // the first one is remembered as default locale
        if (!defaultLocale) {
          defaultLocale = locale;
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
              Logger.error(err);
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
                Logger.error(err);
                translated = sText;
              }
            } else {
              try {
                translated = vsprintf(pText, args);
              } catch (err) {
                Logger.error(err);
                translated = pText;
              }
            }
          }
          return translated;
        };

        // finally, signal the callback
        if (_.isFunction(callback)) {
          logInfoFn('Loading Finished i18n for ' + code)
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

i18n.getLocaleForLanguage = function (code) {
  var locale = null;

  if (code && loadedLanguages[code]) {
    locale = loadedLanguages[code];
  }

  if (!locale) {
    locale = defaultLocale;
    logInfoFn('Using default locale because there is none matching the request\'s language "%s"', code);
  }

  return locale;
};


/**
 * Logging proxies
 */

function logDebug(msg) {
  logDebugFn(msg);
}

function logInfo(msg) {
  logInfoFn(msg);
}

function logWarn(msg) {
  logWarnFn(msg);
}

function logError(msg) {
  logErrorFn(msg);
}
