(function ($, undefined) {
    'use strict';
    function pad(number, length) {
        var str = '' + number;
        while (str.length < length) {
            str = '0' + str;
        }
        return str;
    };

    var calcSpeed = function (blob) {
        var st = blob.statistics;
        var now = new Date();
        if (!st._markLoaded) {
            st._markLoaded = 0;
            st._markTime = blob.start;
        }
        if (now - st._markTime == 0) {
            return;
        }
        var current = (blob.loaded - st._markLoaded) / ((now - st._markTime) / 1000);
        st.maxSpeed = isNaN(st.maxSpeed) ? current : Math.max(st.maxSpeed, current);
        st.minSpeed = isNaN(st.minSpeed) ? current : Math.min(st.minSpeed, current);
        st.currentSpeed = current;
        st.averageSpeed = blob.loaded / ((now - st.startTime) / 1000);
        st._markLoaded = blob.loaded;
        st._markTime = now;
    };

    var status = {
        init: 0,
        uploading: 1,
        uncommit: 2,
        success: 4,
        error: 8
    };

    var blockCollection = function () {
        this.list = {};
        this.length = 0;
    };

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
            if (block.times <= block.blob.retry) {
                delete this.list[id];
                this.length--;
                return block;
            }
        }
        return null;
    };

    blockCollection.prototype.resetTimes = function () {
        for (var id in this.list) {
            this.list[id].times = 0;
        }
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
        checkBlobStatus(blob);
        blob.sendingBlocks.push(this);
        //only the first block send trigged the blob befor send event.
        if (blob.beforeSend && blob.status == status.init) {
            blob.statistics.startTime = new Date();
            blob.beforeSend.call(blob, this, xhr);
        }
    };

    var blockInBlobPorgress = function (ev) {
        var blob = this.blob;
        blob.loaded -= this.loaded;
        blob.loaded += ev.loaded;
        calcSpeed(blob);
        if (blob.progress) {
            blob.progress.apply(blob, arguments);
        }
    };

    var blockInBlobSuccess = function () {
        var blob = this.blob;
        blob.sendingBlocks.remove(this);
        blob.successBlocks.push(this);
        checkBlobStatus(blob);
        //all block upload success, execute the blob commit function.
        if (blob.status == status.uncommit) {
            blob.statistics.endTime = new Date();
            delete blob.statistics["_markLoaded"];
            delete blob.statistics["_markTime"];
            blob.commit();
        }
    };

    var blockInBlobError = function (xhr, desc, err) {
        var blob = this.blob;
        blob.sendingBlocks.remove(this);
        blob.errorBlocks.push(this);
        checkBlobStatus(blob);
        if (blob.error) {// && blob.status != status.uploading) {
            blob.error.call(blob, this, xhr, desc, err);
        }
    };

    var checkBlobStatus = function (blob) {
        if (blob.status == status.success || blob.status == status.uncommit) {
            return;
        }
        if (blob.sendingBlocks.length > 0) {
            blob.status = status.uploading;
        }
        else if (blob.errorBlocks.length > 0) {
            blob.status = status.error;
        }
        else if (blob.noMoreBlock()) {
            if (blob.successBlocks.length == blob.blocks.length) {
                blob.status = status.uncommit;
            }
        } else {
            if (blob.successBlocks.length > 0) {
                blob.status = status.uploading;
            } else {
                blob.status = status.init;
            }
        }
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
        this.blocks = new blockCollection();
        this.errorBlocks = new blockCollection();
        this.sendingBlocks = new blockCollection();
        this.successBlocks = new blockCollection();
        this.init();
    };
    blob.prototype.init = function () {
        this.pointer = 0;
        this.loaded = 0;
        this.statistics = {};
        this.status = status.init;
        this.blocks.clear();
        this.sendingBlocks.clear();
        this.errorBlocks.clear();
        this.successBlocks.clear();
    };
    blob.prototype.noMoreBlock = function () {
        return this.pointer >= this.size;
    };

    blob.prototype.nextBlock = function () {
        if (!this.noMoreBlock()) {
            var _block = new block(this, this.pointer, this.blockSize);
            this.blocks.push(_block);
            _block.beforeSend = blockInBlobBeforeSend;
            _block.progress = blockInBlobPorgress;
            _block.success = blockInBlobSuccess;
            _block.error = blockInBlobError;
            this.pointer += _block.size;
            return _block;
        }
        return this.errorBlocks.shift();
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
    blob.prototype.resend = function () {
        this.errorBlocks.resetTimes();
        this.send();
    };
    blob.prototype.commit = function () {
        var uri = this.url + '&comp=blocklist'
            , data = []
            , ids = this.blocks.ids()
            , len = ids.length;
        data.push('<?xml version="1.0" encoding="utf-8"?><BlockList>');
        for (var i = 0; i < len; i++) {
            data.push('<Latest>' + ids[i] + '</Latest>');
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
                $t.statistics.endTime = new Date();
                if ($t.success) {
                    $t.success(data, sta);
                }
            },
            error: function (xhr, desc, err) {
                $t.status = status.error;
                $t.desc = desc;
                $t.err = err;
                $t.statistics.endTime = new Date();
                if ($t.error) {
                    $t.error(null, xhr, desc, err);
                }
            }
        });
    };
    var block = function (blob, pointer, size) {
        this.blob = blob;
        this.content = blob.file.slice(pointer, pointer + size);
        this.size = this.content.size;
        this.pointer = pointer;
        this.status = status.init;
        this.id = btoa("block-" + pad(blob.blocks.length, 6)).replace(/=/g, 'a');
        this.url = blob.url + '&comp=block&blockid=' + this.id;
        this.loaded = 0;
        this.times = 0;
    };
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
                            if (block.progress) {
                                block.progress(ev);
                            }
                            block.loaded = ev.loaded;
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
                block.times += 1;
                block.status = status.uploading;
            },
            success: function (data, sta) {
                block.status = status.success;
                block.desc = null;
                block.err = null;
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

    var task = function (maxThread) {
        this.maxThread = maxThread;
        this.running = 0;
        this.blobs = [];
    };

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
            for (var idx = 0; idx < len; idx++) {
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
            retry: 1,
            beforeSend: null,//function(blob)
            error: null,	//function(blob,xhr, desc, err)
            progress: null,//function(blob)
            success: null //function(blob,data,status)
        },
        _create: function () {
            this.task = new task();
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
                        _blob.retry = options.retry;
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
                blob.errorBlocks.resetTimes();
            } else {
                var len = this.task.blocks.length;
                for (var idx = 0; idx < len; idx++) {
                    this.task.blobs[i].errorBlocks.resetTimes();
                }
            }
            this.task.send(blob);
        },
        reset: function (blob) {
            this.task.reset(blob);
        }
    });
})(jQuery);