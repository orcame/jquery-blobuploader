(function ($, undefined) {
    var totalSize = 0;

    function pad(number, length) {
        var str = '' + number;
        while (str.length < length) {
            str = '0' + str;
        }
        return str;
    };
    var status = {
        init: 0,
        uploading: 1,
        success: 2,
        error: 3
    };

    var blob = function (element, container, blockSize) {
        var qidx = container.indexOf("?");
        var file = element[0].files[0];
        this.element = element;
        this.file = file;
        this.size = file.size;
        this.type = file.type;
        this.name = file.name;
        this.blobUrl = container.substring(0, qidx) + '/' + file.name;
        this.url = this.blobUrl + container.substring(qidx);

        this.blockSize = blockSize;
        this.blocks = [];
    }
    blob.prototype.init = function () {
        this.loaded = 0;
        this.speed = { max: 0, min: Infinity };
        this.start = new Date();
        this.end = null;
    };
    var calcSpeed = function (blob) {
        var now = new Date();
        if (!blob._markLoaded) {
            blob._markLoaded = 0;
            blob._markTime = blob.start;
        }
        if (now - blob._markTime == 0) {
            return;
        }
        var speed = blob.speed;
        var current = (blob.loaded - blob._markLoaded) / ((now - blob._markTime) / 1000);
        speed.max = Math.max(speed.max, current);
        speed.min = Math.min(speed.min, current);
        speed.current = current;
        speed.average = blob.loaded / ((now - blob.start) / 1000);
        blob._markLoaded = blob.loaded;
        blob._markTime = now;
    };
    blob.prototype.split = function () {
        var $t = this;
        var blockSuccess = function () {
            if ($t.allBlockUploadSuccess()) {
                $t.commit();
            }
        };
        var blockError = function (xhr, desc, err) {
            if ($t.error) {
                if (!$t.hasUploadingBlocks()) {
                    $t.error.call($t, xhr, "Blob upload error,call blob.errorBlocks() check the detail.", err);
                }
            }
        };
        var blockProgress = function (ev) {
            if ($t.progress) {
                $t.loaded = 0;
                for (var i = $t.blocks.length - 1; i >= 0; i--) {
                    $t.loaded += $t.blocks[i].loaded | 0;
                };
                calcSpeed($t);
                $t.progress.apply($t, arguments);
            };
        };
        var blockBeforeSend = function (xhr) {
            $t.init();
            if ($t.beforeSend) {
                $t.beforeSend.call($t, this, xhr);
            }
        };
        var csize = 0, idx = 0;
        while (csize < this.size) {
            var _block = new block(this, csize, this.blockSize);
            _block.index = idx;
            _block.beforeSend = blockBeforeSend;
            _block.progress = blockProgress;
            _block.success = blockSuccess;
            _block.error = blockError;
            idx++;
            csize += this.blockSize;
        }
    };

    blob.prototype.findBlocksByStatus = function (status) {
        var result = [];
        var len = this.blocks.length;
        for (var i = 0; i < len; i++) {
            if (this.blocks[i].status == status) {
                result.push(this.blocks[i]);
            }
        }
        return result;
    };
    blob.prototype.uploadingBlocks = function () {
        return this.findBlocksByStatus(status.uploading);
    };
    blob.prototype.errorBlocks = function () {
        return this.findBlocksByStatus(status.error);
    };
    blob.prototype.successBlocks = function () {
        return this.findBlocksByStatus(status.success);
    };
    blob.prototype.hasUploadErrorBlocks = function () {
        return this.errorBlocks().length > 0;
    };
    blob.prototype.allBlockUploadSuccess = function () {
        return this.successBlocks().length == this.blocks.length;
    };
    blob.prototype.hasUploadingBlocks = function () {
        return this.uploadingBlocks().length > 0;
    };

    var sendBlobBlocks = function (blob, blocks, beforeSend, progress, success, error) {
        blocks = blocks || blob.blocks;
        var _beforeSend = null, _success = null, _error = null;
        if (beforeSend) {
            _beforeSend = function () {
                if (this.blob.status == status.init) {
                    beforeSend.apply(this.blob, arguments);
                }
            }
        };
        if (success) {
            _success = function () {
                if (this.blob.status == status.success) {
                    success.apply(this.blob, arguments);
                }
            }
        }
        if (error) {
            _error = function () {
                if (this.blob.status == status.error) {
                    error.apply(this.blob, arguments);
                }
            }
        }
        var len = blocks.length;
        for (var i = 0; i < len ; i++) {
            var block = blocks[i];
            block.send(_beforeSend, progress, _success, _error);
        };
    };
    blob.prototype.send = function (beforeSend, progress, success, error) {
        this.split();
        sendBlobBlocks(this, null, beforeSend, progress, success, error);
    };
    blob.prototype.retry = function (beforeSend, progress, success, error) {
        var blocks = blob.errorBlocks();
        sendBlobBlocks(this, blocks, beforeSend, progress, success, error);
    };
    blob.prototype.commit = function (success, error) {
        if (this.committing) {
            return;
        }
        this.committing = true;
        var _success = mergeFunction(this.success, success);
        var _error = mergeFunction(this.error, error);
        var uri = this.url + '&comp=blocklist'
			, data = []
			, len = this.blocks.length;
        data.push('<?xml version="1.0" encoding="utf-8"?><BlockList>');
        for (var i = 0; i < len; i++) {
            data.push('<Latest>' + this.blocks[i].id + '</Latest>');
        }
        data.push('</BlockList>');
        var $t = this;
        $.ajax({
            url: uri,
            type: "PUT",
            data: data.join(''),
            beforeSend: function (xhr) {
                xhr.setRequestHeader('x-ms-blob-content-type', this.type);
            },
            success: function (data, sta) {
                $t.status = status.success;
                $t.end = new Date();
                $t.committing = false;
                if (_success) {
                    _success.call($t, data, sta);
                }
            },
            error: function (xhr, desc, err) {
                $t.status = status.error;
                $t.desc = desc;
                $t.err = err;
                $t.end = new Date();
                $t.committing = false;
                if (_error) {
                    _error.call($t, xhr, desc, err);
                }
            }
        });
    };
    var block = function (blob, pointer, size) {
        blob.blocks.push(this);
        this.blob = blob;
        this.pointer = pointer;
        this._preSize = size;
        this.status = status.init;
        this.id = btoa("block-" + pad(blob.blocks.length, 6)).replace(/=/g, 'a');
    };
    var mergeFunction = function (func1, func2) {
        var args = arguments;
        return function () {
            for (var i = args.length - 1; i >= 0; i--) {
                if (typeof (args[i]) == 'function') {
                    args[i].apply(this, arguments);
                }
            };
        }
    };
    var sendBlock = function (block, data, beforeSend, progress, success, error) {
        beforeSend = mergeFunction(block.beforeSend, beforeSend);
        progress = mergeFunction(block.progress, progress);
        success = mergeFunction(block.success, success);
        error = mergeFunction(block.error, error);
        var uri = block.blob.url + '&comp=block&blockid=' + block.id;
        $.ajax({
            url: uri,
            type: "PUT",
            data: data,
            processData: false,
            xhr: function () {  // Custom XMLHttpRequest
                var myXhr = $.ajaxSettings.xhr();
                if (myXhr.upload) { // Check if upload property exists
                    myXhr.upload.addEventListener('progress', function (ev) {
                        if (ev.lengthComputable) {
                            block.loaded = ev.loaded;
                            block.total = ev.total;
                            if (progress) {
                                progress.call(block, ev)
                            }
                        }
                    }, false); // For handling the progress of the upload
                }
                return myXhr;
            },
            beforeSend: function (xhr) {
                xhr.setRequestHeader('x-ms-blob-type', 'BlockBlob');
                //xhr.setRequestHeader('Content-Length', block.size);

                if (beforeSend) {
                    beforeSend.call(block, xhr);
                }
                block.status = status.uploading;
            },
            success: function (data, sta) {
                block.status = status.success;
                block.desc = null;
                block.err = null;
                if (success) {
                    success.call(block, data, status);
                }
            },
            error: function (xhr, desc, err) {
                block.status = status.error;
                block.desc = desc;
                block.err = err;
                if (error) {
                    error.call(block, xhr, desc, err);
                }
                console.log(desc, err);
            }
        });
    };

    block.prototype.send = function (beforeSend, progress, success, error) {
        var $t = this
			, reader = new FileReader();
        reader.onloadend = function (ev) {
            if (ev.target.readyState == FileReader.DONE) {
                var data = new Uint8Array(ev.target.result);
                sendBlock($t, data, beforeSend, progress, success, error);
            }
        }
        var content = $t.blob.file.slice(this.pointer, this.pointer + this._preSize);
        $t.size = content.size;
        reader.readAsArrayBuffer(content);
    };

    var task = function (maxThread) {
        this.maxThread = maxThread;
        this.running = 0;
        this.blobs = [];
        this.blocks = [];
    };
    task.prototype.addBlock = function (block) {
        this.blocks.push(block);
    };
    task.prototype.run = function () {
        var $t = this, onEnd = function () {
            $t.running--;
            var _block = $t.blocks.shift();
            if (_block) {
                _block.send(null, null, onEnd, onEnd);
            }
        };
        while ($t.maxThread > 0 && $t.running < $t.maxThread) {
            var block = $t.blocks.shift();
            if (block) {
                block.send(null, null, onEnd, onEnd);
            } else {
                break;
            }
        }
    };
    task.prototype.retryBlob = function (blob) {
        if (!blob) {
            return;
        }
        for (var i = blob.blocks.length - 1; i >= 0; i--) {
            var block = blob.blocks[i];
            if (block.status == status.error) {
                this.blocks.push(block);
            }
        };
        this.run();
    };
    task.prototype.retry = function () {
        for (var i = this.blobs.length - 1; i >= 0; i--) {
            this.retryBlob(this.blobs[i]);
        };
    };
    task.prototype.addBlob = function (blob) {
        blob.split();
        this.blobs.push(blob);
        var len = blob.blocks.length;
        for (var idx = 0; idx < len; idx++) {
            this.addBlock(blob.blocks[idx]);
        }
    };

    $.widget('azure.blobuploader', {
        options: {
            url: null,
            blockSizeKB: 2048,
            skipSuccessFile: true,
            maxThread: 20,
            beforeSend: null,//function(blob)
            error: null,	//function(blob,xhr, desc, err)
            progress: null,//function(blob)
            success: null //function(blob,data,status)
        },
        _create: function () {
            this.task = new task();
            this.blobs = [];
        },
        upload: function () {
            var $t = this, options = this.options;
            var blobBeforeSend = function () {
                if (options.beforeSend) {
                    options.beforeSend.call($t, this);
                }
            };
            var blobProgress = function (ev) {
                if (options.progress) {
                    options.progress.call($t, this, ev)
                }
            };
            var blobSuccess = function (data, status) {
                if (options.success) {
                    options.success.call($t, this, data, status);
                }
            };
            var blobError = function (xhr, desc, err) {
                if (options.error) {
                    options.error.call($t, this, xhr, desc, err);
                }
            };
            if (!options.skipSuccessFile) {
                this.blobs.length = 0;
            }
            this.element.find('input[type="file"]').each(function () {
                $t.task.maxThread = options.maxThread;
                if ($(this).val()) {
                    var _blob = $t.blob(this);
                    if (!_blob) {
                        _blob = new blob($(this), options.url, options.blockSizeKB * 1024);
                        _blob.beforeSend = blobBeforeSend;
                        _blob.progress = blobProgress;
                        _blob.success = blobSuccess;
                        _blob.error = blobError;
                        $t.blobs.push(_blob);
                        $t.task.addBlob(_blob);
                    } else {
                        if (options.skipSuccessFile) {
                            if (blob.status != status.success) {
                                var _blocks = _blob.errorBlocks();
                                $.each(_blocks, function () {
                                    $t.task.addBlock(this)
                                })
                            }
                        } else {
                            $t.task.addBlob(_blob);
                        }
                    }
                    $t.task.run();
                }
            })
            if (!this.blobs.length) {
                throw "Please select file first.";
            }
        },
        blob: function (element) {
            if (typeof (element) == 'string') {
                element = $('element').get(0);
            } else if (element instanceof jQuery) {
                element = element.get(0);
            }
            for (var i = this.blobs.length - 1; i >= 0; i--) {
                if (this.blobs[i].element.get(0) == element) {
                    return this.blobs[i];
                }
            };
            return null;
        },
        retry: function (element) {
            if (!element) {
                this.task.retry();
            } else {
                var blob = this.blob(element);
                if (blob) {
                    this.task.retry(blob);
                }
            }
        }
    });
})(jQuery);