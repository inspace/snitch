var fs = require('fs');
var confess = {

    run: function () {
        var cliConfig = {};
        if (!this.processArgs(cliConfig, [
            {
                name: 'url',
                def: 'http://google.com',
                req: true,
                desc: 'the URL of the site to profile'
            }, {
                name: 'task',
                def: 'appcache',
                req: false,
                desc: 'the task to perform',
                oneof: ['performance', 'appcache', 'cssproperties']
            }, {
                name: 'configFile',
                def: 'config.json',
                req: false,
                desc: 'a local configuration file of further confess settings'
            },
        ])) {
            phantom.exit();
            return;
        }
        this.config = this.mergeConfig(cliConfig, cliConfig.configFile);
        var task = this[this.config.task];
        this.load(this.config, task, this);
    },

    performance: {
        resources: [],
        evalConsole : {},
        evalConsoleErrors: [],

        onInitialized: function(page, config) {

            var pageeval = page.evaluate(function(startTime) {
                var now = new Date().getTime();
                //check the readystate within the page being loaded

                //Returns "loading" while the document is loading
                var _timer3 = setInterval(function(){
                    if(/loading/.test(document.readyState)){
                        console.log('loading-' + (new Date().getTime() - startTime));
                        //don't clear the interval until we get last measurement
                    }
                }, 5);

                // "interactive" once it is finished parsing but still loading sub-resources
                var _timer1 = setInterval(function(){
                    if(/interactive/.test(document.readyState)){
                        console.log('interactive-' + (new Date().getTime() - startTime));
                        clearInterval(_timer1);
                        //clear loading interval
                        clearInterval(_timer3);
                    }
                }, 5);

                //The DOMContentLoaded event is fired when the document has been completely
                //loaded and parsed, without waiting for stylesheets, images, and subframes
                //to finish loading
                document.addEventListener("DOMContentLoaded", function() {
                    console.log('DOMContentLoaded-' + (new Date().getTime() - startTime));
                }, false);

                //detect a fully-loaded page
                window.addEventListener("load", function() {
                    console.log('onload-' + (new Date().getTime() - startTime));
                }, false);

            }, this.performance.start);
        },

        onLoadStarted: function (page, config) {
            //This callback is invoked when the page starts the loading
            if (!this.performance.start) {
                this.performance.start = new Date().getTime();
            }
        },

        onResourceRequested: function (page, config, request) {
            //This callback is invoked when the page requests a resource
            //Should only be invoked once per resource
            var now = new Date().getTime();
            this.performance.resources[request.id] = {
                id: request.id,
                url: request.url,
                request: request,
                responses: {},
                duration: '-',
                times: {
                    request: now
                }
            };
            if (!this.performance.start || now < this.performance.start) {
                this.performance.start = now;
            }
        },

        onResourceReceived: function (page, config, response) {
            //This callback is invoked when the a resource requested by the page is received
            //If the resource is large and sent by the server in multiple chunks
            var now = new Date().getTime(),
            resource = this.performance.resources[response.id];
            resource.responses[response.stage] = response;
            if (!resource.times[response.stage]) {
                resource.times[response.stage] = now;
                resource.duration = now - resource.times.request;
            }

            /*
            if (response.bodySize) {
                resource.size = response.bodySize;
            } else if (!resource.size) {
                response.headers.forEach(function (header) {
                    if (header.name.toLowerCase()=='content-length') {
                        resource.size = parseInt(header.value);
                    }
                });
            }*/
            
            /*
            * There is currently a bug in PhantomJS which prevents 
            * response.bodySize from returning the correct size.
            * We defer to content-length first if it is available.
            */
            response.headers.forEach(function (header) {
                if (header.name.toLowerCase()=='content-length') {
                    resource.size = parseInt(header.value);
                }
            });
            if (!resource.size) {
                resource.size = response.bodySize;
            }

        },

        onLoadFinished: function (page, config, status) {
            //This callback is invoked when the page finishes the loading
            var start = this.performance.start,
                finish =  new Date().getTime(),
                resources = this.performance.resources,
                slowest, fastest, totalDuration = 0,
                largest, smallest, totalSize = 0,
                missingSize = false,
                onload = this.performance.evalConsole.onload,
                loading = this.performance.evalConsole.loading,
                interactive = this.performance.evalConsole.interactive,
                elapsed = finish - start;

            resources.forEach(function (resource) {
                if (!resource.times.start) {
                    resource.times.start = resource.times.end;
                }
                if (!slowest || resource.duration > slowest.duration) {
                    slowest = resource;
                }
                if (!fastest || resource.duration < fastest.duration) {
                    fastest = resource;
                }
                totalDuration += resource.duration;

                if (resource.size) {
                    if (!largest || resource.size > largest.size) {
                        largest = resource;
                    }
                    if (!smallest || resource.size < smallest.size) {
                        smallest = resource;
                    }
                    totalSize += resource.size;
                } else {
                    resource.size = '-';
                    missingSize = true;
                }
            });

            console.log('Loadtime: '+elapsed+' numresources: '+(resources.length-1)+
                        ' totalresourcebytes: '+totalSize+' loading: '+loading+
                        ' interactive: '+interactive+' onload: '+onload);
            //console.log('Loading: '+loading+' interactive: '+interactive+' parsed: '+parsed+' complete: '+complete);
            resources.forEach(function (resource) {
                console.log(
                    resource.id + ' ' +
                    (resource.times.request - start) + ' ' +
                    (resource.times.start - resource.times.request) + ' ' +
                    resource.duration + ' ' +
                    resource.size + ' ' +
                    resource.url
                );
            });
        
        }
    },

    getFinalUrl: function (page) {
        return page.evaluate(function () {
            return document.location.toString();
        });
    },

    getResourceUrls: function (page) {
        return page.evaluate(function () {
            var
                // resources referenced in DOM
                // notable exceptions: iframes, rss, links
                selectors = [
                    ['script', 'src'],
                    ['img', 'src'],
                    ['link[rel="stylesheet"]', 'href']
                ],

                resources = {},
                baseScheme = document.location.toString().split("//")[0],
                tallyResource = function (url) {
                    if (url && url.substr(0,5)!='data:') {
                        if (url.substr(0, 2)=='//') {
                            url = baseScheme + url;
                        }
                        if (!resources[url]) {
                            resources[url] = 0;
                        }
                        resources[url]++;
                    }
                },

                elements, elementsLength, e,
                stylesheets, stylesheetsLength, ss,
                rules, rulesLength, r,
                style, styleLength, s,
                computed, computedLength, c,
                value;

            // attributes in DOM
            selectors.forEach(function (selectorPair) {
                elements = document.querySelectorAll(selectorPair[0]);
                for (e = 0, elementsLength = elements.length; e < elementsLength; e++) {
                    tallyResource(elements[e].getAttribute(selectorPair[1]));
                };
            });

            // URLs in stylesheets
            stylesheets = document.styleSheets;
            for (ss = 0, stylesheetsLength = stylesheets.length; ss < stylesheetsLength; ss++) {
                rules = stylesheets[ss].rules;
                if (!rules) { continue; }
                for (r = 0, rulesLength = rules.length; r < rulesLength; r++) {
                    if (!rules[r]['style']) { continue; }
                    style = rules[r].style;
                    for (s = 0, styleLength = style.length; s < styleLength; s++) {
                        value = style.getPropertyCSSValue(style[s]);
                        if (value && value.primitiveType == CSSPrimitiveValue.CSS_URI) {
                            tallyResource(value.getStringValue());
                        }
                    }
                };
            };

            // URLs in styles on DOM
            elements = document.querySelectorAll('*');
            for (e = 0, elementsLength = elements.length; e < elementsLength; e++) {
                computed = elements[e].ownerDocument.defaultView.getComputedStyle(elements[e], '');
                for (c = 0, computedLength = computed.length; c < computedLength; c++) {
                    value = computed.getPropertyCSSValue(computed[c]);
                    if (value && value.primitiveType == CSSPrimitiveValue.CSS_URI) {
                        tallyResource(value.getStringValue());
                    }
                }
            };

            return resources;
        });
    },

    getCssProperties: function (page) {
        return page.evaluate(function () {
            var properties = {},
                tallyProperty = function (property) {
                    if (!properties[property]) {
                        properties[property] = 0;
                    }
                    properties[property]++;
                },
                stylesheets, stylesheetsLength, ss,
                rules, rulesLength, r,
                style, styleLength, s,
                property;

            // properties in stylesheets
            stylesheets = document.styleSheets;
            for (ss = 0, stylesheetsLength = stylesheets.length; ss < stylesheetsLength; ss++) {
                rules = stylesheets[ss].rules;
                if (!rules) { continue; }
                for (r = 0, rulesLength = rules.length; r < rulesLength; r++) {
                    if (!rules[r]['style']) { continue; }
                    style = rules[r].style;
                    for (s = 0, styleLength = style.length; s < styleLength; s++) {
                        tallyProperty(style[s]);
                    }
                }
            }

            // properties in styles on DOM
            elements = document.querySelectorAll('*');
            for (e = 0, elementsLength = elements.length; e < elementsLength; e++) {
                rules = elements[e].ownerDocument.defaultView.getMatchedCSSRules(elements[e], '');
                if (!rules) { continue; }
                for (r = 0, rulesLength = rules.length; r < rulesLength; r++) {
                    if (!rules[r]['style']) { continue; }
                    style = rules[r].style;
                    for (s = 0, styleLength = style.length; s < styleLength; s++) {
                        tallyProperty(style[s]);
                    }
                }
            }
            return properties;
        });
    },

    emitConfig: function (config, prefix) {
        console.log(prefix + 'Config:');
        for (key in config) {
           if (config[key].constructor === Object) {
                if (key===config.task) {
                    console.log(prefix + ' ' + key + ':');
                    for (key2 in config[key]) {
                        console.log(prefix + '  ' + key2 + ': ' + config[key][key2]);
                    }
                }
           } else {
               console.log(prefix + ' ' + key + ': ' + config[key]);
           }
       }
    },

    load: function (config, task, scope) {
        var page = new WebPage(),
            event;
        if (config.consolePrefix) {
            page.onConsoleMessage = function (msg, line, src) {
                console.log(config.consolePrefix + ' ' + msg + ' (' + src + ', #' + line + ')');
            }
        }
        if (config.userAgent && config.userAgent != "default") {
            if (config.userAgentAliases[config.userAgent]) {
                config.userAgent = config.userAgentAliases[config.userAgent];
            }
            page.settings.userAgent = config.userAgent;
        }
        ['onInitialized', 'onLoadStarted', 'onResourceRequested', 'onResourceReceived']
        .forEach(function (event) {
            if (task[event]) {
                page[event] = function () {
                    var args = [page, config],
                        a, aL;
                    for (a = 0, aL = arguments.length; a < aL; a++) {
                        args.push(arguments[a]);
                    }
                    task[event].apply(scope, args);
                };
            }
        });
        if (task.onLoadFinished) {
            page.onLoadFinished = function (status) {
                if (config.wait) {
                    setTimeout(
                        function () {
                            task.onLoadFinished.call(scope, page, config, status);
                            phantom.exit();
                        },
                        config.wait
                    );
                } else {
                    task.onLoadFinished.call(scope, page, config, status);
                    phantom.exit();
                }
            };
        } else {
            page.onLoadFinished = function (status) {
                phantom.exit();
            }
        }

        page.settings.localToRemoteUrlAccessEnabled = true;
        page.settings.webSecurityEnabled = false;
        page.onConsoleMessage = function (msg) {
            //console.log(msg)
            if (msg.indexOf('jserror-') >= 0){
                confess.performance.evalConsoleErrors.push(msg.substring('jserror-'.length, msg.length));
            } else{
                if (msg.indexOf('loading-') >= 0){
                    confess.performance.evalConsole.loading = msg.substring('loading-'.length, msg.length);
                } else if (msg.indexOf('interactive-') >= 0){
                    confess.performance.evalConsole.interactive = msg.substring('interactive-'.length, msg.length);
                } else if (msg.indexOf('onload-') >= 0){
                    confess.performance.evalConsole.onload = msg.substring('onload-'.length, msg.length);
                }
            }
        };

        page.open(config.url);
    },

    processArgs: function (config, contract) {
        var a = 0;
        var ok = true;
        contract.forEach(function(argument) {
            if (a < phantom.args.length) {
                config[argument.name] = phantom.args[a];
            } else {
                if (argument.req) {
                    console.log('"' + argument.name + '" argument is required. This ' + argument.desc + '.');
                    ok = false;
                } else {
                    config[argument.name] = argument.def;
                }
            }
            if (argument.oneof && argument.oneof.indexOf(config[argument.name])==-1) {
                console.log('"' + argument.name + '" argument must be one of: ' + argument.oneof.join(', '));
                ok = false;
            }
            a++;
        });
        return ok;
    },

    mergeConfig: function (config, configFile) {
        if (!fs.exists(configFile)) {
           configFile = "config.json";
        }
        var result = JSON.parse(fs.read(configFile)),
            key;
        for (key in config) {
            result[key] = config[key];
        }
        return result;
    },

    truncate: function (str, length) {
        length = length || 80;
        if (str.length <= length) {
            return str;
        }
        var half = length / 2;
        return str.substr(0, half-2) + '...' + str.substr(str.length-half+1);
    },

    pad: function (str, length) {
        var padded = str.toString();
        if (padded.length > length) {
            return this.pad(padded, length * 2);
        }
        return this.repeat(' ', length - padded.length) + padded;
    },

    repeat: function (chr, length) {
        for (var str = '', l = 0; l < length; l++) {
            str += chr;
        }
        return str;
    },

}

confess.run();