(function ($, global) {
    'use strict';
    function pad(number, length) {
        var str = '' + number;
        while (str.length < length) {
            str = '0' + str;
        }
        return str;
    };

    function now() {
        return new Date();
    };

    function time() {
        return now().getTime();
    };

    function readableSize(value) {
        var units = ["B", "KB", "MB", "GB", "TB", "PB"];
        for (var idx = 0; idx < units.length; idx++) {
            if (value < 1024) {
                return value.toFixed(2) + units[idx];
            }
            value = value / 1024;
        }
    };
    var status = {
        init: 0,
        uploading: 1,
        uncommit: 2,
        success: 4,
        error: 8
    };

    function blockCollection() {
        this.list = {};
        this.length = 0;
    }

    blockCollection.prototype.push = function (block) {
        if (!this.list[block.id]) {
            this.length++;
        }
        this.list[block.id] = block;
    };

    blockCollection.prototype.shift = function () {
        if (this.length == 0) {
            return null;
        }
        for (var id in this.list) {
            var block = this.list[id];
            delete this.list[id];
            this.length--;
            return block;
        }
        return null;
    };

    blockCollection.prototype.remove = function (block) {
        if (!block) {
            return;
        }
        if (this.list[block.id]) {
            delete this.list[block.id];
            this.length--;
        }
    };

    blockCollection.prototype.clear = function () {
        for (var id in this.list) {
            delete this.list[id];
            this.length--;
        }
    };

    blockCollection.prototype.ids = function () {
        var ids = [];
        for (var id in this.list) {
            ids.push(id);
        }
        return ids;
    };

    var blockInBlobBeforeSend = function (xhr) {
        var blob = this.blob;
        blob.thread += 1;
        checkBlobStatus(blob);
        if (blob.thread == 1) {
            blob.start = now();
            //only the first block send trigged the blob befor send event.
            if (blob.beforeSend) {
                blob.beforeSend.call(blob, this, xhr);
            }
        }
    };

    var blockInBlobPorgress = function (ev) {
        var blob = this.blob;
        if (blob.progress) {
            blob.progress.apply(blob, arguments);
        }
    };

    var blockInBlobSuccess = function () {
        var blob = this.blob;
        blob.thread -= 1;
        checkBlobStatus(blob);
        //all block upload success, execute the blob commit function.
        if (blob.status == status.uncommit) {
            blob.commit();
        }
    };

    var blockInBlobError = function (xhr, desc, err) {
        var blob = this.blob;
        blob.thread -= 1;
        blob.errorBlocks.push(this);
        checkBlobStatus(blob);
        if (blob.error) {// && blob.status != status.uploading) {
            blob.error.call(blob, this, xhr, desc, err);
        }
    };

    var checkBlobStatus = function (blob) {
        if (blob.thread > 0) {
            blob.status = status.uploading;
        } else if (blob.errorBlocks.length > 0) {
            blob.status = status.error;
        } else if (blob.status == status.success) {
            return;
        } else if (blob.loaded == blob.size) {
            blob.status = status.uncommit;
        }
    };

    function blob(element, container, blockSize) {
        var qidx = container.indexOf("?");
        var file = element[0].files[0];
        this.element = element;
        this.file = file;
        this.size = file.size;
        this.type = file.type;
        this.name = file.name;
        this.blobUrl = container.substring(0, qidx) + '/' + file.name;
        this.breakWhenError = false;
        this.url = this.blobUrl + container.substring(qidx);
        this.blockSize = blockSize || (4096 * 1024);
        this.blocks = [];
        this.errorBlocks = new blockCollection();
        this.queue = new blockCollection();
        this.init();
    }

    blob.prototype.init = function () {
        this.pointer = 0;
        this.loaded = 0;
        this.thread = 0;
        this.status = status.init;
        this.blocks.length = 0;
        this.queue.clear();
        this.errorBlocks.clear();
    };

    blob.prototype.nextBlock = function () {
        if (this.breakWhenError && this.errorBlocks.length > 0) {
            return null;
        }
        if (this.pointer < this.size) {
            var _block = new block(this, this.pointer, this.blockSize);
            this.blocks.push(_block);
            _block.beforeSend = blockInBlobBeforeSend;
            _block.progress = blockInBlobPorgress;
            _block.success = blockInBlobSuccess;
            _block.error = blockInBlobError;
            this.pointer += _block.size;
            return _block;
        }
        return this.queue.shift();
    };
    blob.prototype.send = function () {
        function end() {
            var block = this.blob.nextBlock();
            if (block) {
                block.send(end);
            }
        }
        var threads = this.maxThread > 0 ? this.maxThread : -1;
        while (threads > 0 || threads == -1) {
            var block = this.nextBlock();
            if (!block) {
                break;
            }
            block.send(end);
            if (threads > 0) {
                threads--;
            }
        }
    };
    blob.prototype.speed = function (readable) {
        var result = null;
        if (this.__speed__) {
            result = this.__speed__;
        } else {
            var min, max, average, len = this.blocks.length, loaded = 0;
            var start = this.start, end = this.end || now();
            for (var idx = 0; idx < len; idx++) {
                var sp = this.blocks[idx].speed();
                if(sp !== null){
                max = max == null ? sp.max : Math.max(sp.max, max);
                min = min == null ? sp.min : Math.min(sp.min, min);
                start = start == null ? sp.start : Math.min(sp.start, start);
                end = end == null ? sp.end : Math.max(sp.end, end);
                loaded += sp.loaded;
                }
            }
            average = loaded / (end - start) * 1000;
            var result = { start: start, end: end, loaded: loaded, min: min, max: max, average: average };
            if (this.status == status.uncommit || this.status == status.success) {
                this.__speed__ = result;
            }
        }
        if (readable) {
            result.max = readableSize(result.max) + '/S';
            result.min = readableSize(result.min) + '/S';
            result.average = readableSize(result.average) + '/S';
        }
        return result;
    },
    blob.prototype.enqueueErrorBlocks = function () {
        var block = this.errorBlocks.shift();
        while (block) {
            this.queue.push(block);
            block = this.errorBlocks.shift();
        }
    };
    blob.prototype.resend = function () {
        this.enqueueErrorBlocks();
        this.send();
    };
    blob.prototype.commit = function () {
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
                $t.end = now();
                if ($t.success) {
                    $t.success(data, sta);
                }
            },
            error: function (xhr, desc, err) {
                $t.status = status.error;
                $t.desc = desc;
                $t.err = err;
                $t.end = now();
                if ($t.error) {
                    $t.error(null, xhr, desc, err);
                }
            }
        });
    };
    function block(blob, pointer, size) {
        this.blob = blob;
        this.content = blob.file.slice(pointer, pointer + size);
        this.size = this.content.size;
        this.pointer = pointer;
        this.status = status.init;
        this.id = btoa("block-" + pad(blob.blocks.length, 6)).replace(/=/g, 'a');
        this.url = blob.url + '&comp=block&blockid=' + this.id;
        this.loaded = 0;
        this.speedData = [];
    }
    var sendBlock = function (block, data, end) {
        $.ajax({
            url: block.url,
            type: "PUT",
            data: data,
            processData: false,
            xhr: function () {
                var _xhr = $.ajaxSettings.xhr();
                if (_xhr.upload) {
                    _xhr.upload.addEventListener('progress', function (ev) {
                        if (ev.lengthComputable) {
                            block.speedData.push({ time: time(), loaded: ev.loaded });
                            block.blob.loaded += (ev.loaded - block.loaded);
                            block.loaded = ev.loaded;
                            if (block.progress) {
                                block.progress(ev);
                            }
                        }
                    }, false);
                }
                return _xhr;
            },
            beforeSend: function (xhr) {
                xhr.setRequestHeader('x-ms-blob-type', 'BlockBlob');
                if (block.beforeSend) {
                    block.beforeSend(xhr);
                }
                block.start = new Date();
                block.speedData.length = 0;
                block.status = status.uploading;
            },
            success: function (data, sta) {
                block.status = status.success;
                block.desc = null;
                block.err = null;
                block.end = new Date();
                if (block.success) {
                    block.success(data, status);
                }
                if (end) {
                    end(block);
                }
            },
            error: function (xhr, desc, err) {
                block.status = status.error;
                block.desc = desc;
                block.err = err;
                block.end = new Date();
                if (block.error) {
                    block.error(xhr, desc, err);
                }
                if (end) {
                    end(block);
                }
            }
        });
    };
    block.prototype.send = function (end) {
        var $t = this
            , reader = new FileReader();
        reader.onloadend = function (ev) {
            if (ev.target.readyState == FileReader.DONE) {
                var data = new Uint8Array(ev.target.result);
                sendBlock($t, data, end);
            }
        };
        reader.readAsArrayBuffer(this.content);
    };
    block.prototype.speed = function () {
        if (this.__speed__) {
            return this.__speed__;
        }
        if (!this.start || this.speedData.length == 0) {
            return null;
        }
        var time = this.start.getTime()
            , loaded = 0
            , max
            , min
            , current
            , len = this.speedData.length;
        for (var idx = 0; idx < len; idx++) {
            var t = this.speedData[idx];
            current = (t.loaded - loaded) / (t.time - time) * 1000;
            max = max == null ? current : Math.max(max, current);
            min = min == null ? current : Math.min(min, current);
            loaded = t.loaded;
            time = t.time;
        }
        var average = loaded / (time - this.start.getTime()) * 1000;
        var result = { start: this.start, end: new Date(time), loaded: loaded, max: max, min: min, average: average };
        if (this.status == status.success) {
            this.__speed__ = result;
        }
        return result;
    };
    function task(maxThread) {
        this.maxThread = maxThread;
        this.blobs = [];
    }
    task.prototype.nextBlock = function () {
        var len = this.blobs.length;
        for (var idx = 0; idx < len; idx++) {
            var block = this.blobs[idx].nextBlock();
            if (block) {
                return block;
            }
        }
        return null;
    };
    task.prototype.send = function (blob) {
        var threads = this.maxThread > 0 ? this.maxThread : -1;
        var $t = blob || this;
        function end() {
            var block = $t.nextBlock();
            if (block) {
                block.send(end);
            }
        }
        while (threads > 0 || threads == -1) {
            var block = $t.nextBlock();
            if (!block) {
                break;
            }
            block.send(end);
            if (threads > 0) {
                threads--;
            }
        }
    };
    task.prototype.reset = function (blob) {
        if (blob) {
            blob.init();
        } else {
            for (var idx = 0; idx < this.blobs.length; idx++) {
                this.blobs[idx].init();
            }
        }
    };
    task.prototype.addBlob = function (blob) {
        this.blobs.push(blob);
    };
    $.widget('azure.blobuploader', {
        options: {
            url: null,
            blockSizeKB: 4096,
            maxThread: 7,
            breakWhenError: true,
            beforeSend: null,//function(blob)
            error: null,	//function(blob,xhr, desc, err)
            progress: null,//function(blob)
            success: null //function(blob,data,status)
        },
        _create: function () {
            this.task = new task(this.options.maxThread);
        },
        blobs: function () {
            return this.task.blobs;
        },
        blob: function (element) {
            if (typeof (element) == 'string') {
                element = $('element').get(0);
            } else if (element instanceof jQuery) {
                element = element.get(0);
            }
            var blobs = this.blobs();
            for (var i = blobs.length - 1; i >= 0; i--) {
                if (blobs[i].element.get(0) == element) {
                    return blobs[i];
                }
            };
            return null;
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
            var blobError = function (block, xhr, desc, err) {
                if (options.error) {
                    options.error.call($t, this, block, xhr, desc, err);
                }
            };
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
                        _blob.breakWhenError = options.breakWhenError;
                        $t.task.addBlob(_blob);
                    }
                }
            });
            if (!this.blobs().length) {
                throw "Please select file first.";
            } else {
                $t.task.send();
            }
        },
        retry: function (blob) {
            if (blob) {
                blob.enqueueErrorBlocks();
            } else {
                var len = this.task.blobs.length;
                for (var idx = 0; idx < len; idx++) {
                    this.task.blobs[idx].enqueueErrorBlocks();
                }
            }
            this.task.send(blob);
        },
        reset: function (blob) {
            this.task.reset(blob);
        }
    });
})(jQuery, window);
