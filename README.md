# i18n
translation module


##Configuration

    var i18n = require('i18n');

    i18n.configure({
        languages: require(path.join(process.cwd(), 'config/languages.json')),
        defaultLocale: 'de',
        pathToTranslations: path.join(process.cwd(), 'i18n'),
        logDebugFn: Logger.debug,
        logInfoFn: Logger.info,
        logWarnFn: Logger.warn,
        logErrorFn: Logger.error
    });



Initialize module

    i18n.initialize(done);

##middleware usage:

    app.use(i18n.middleware());
