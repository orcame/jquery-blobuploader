(function($,undefined){
	var totalSize=0;

	function pad(number, length) {
        var str = '' + number;
        while (str.length < length) {
            str = '0' + str;
        }
        return str;
    }

	var blob=function(element,container,blockSize){
		var qidx = container.indexOf("?");
		var file=element[0].files[0];
		this.element=element;
		this.file=file;
		this.size=file.size;
		this.type=file.type;
		this.name=file.name;
		this.url=container.substring(0, qidx) + '/' + file.name + container.substring(qidx);
		this.blockSize=blockSize;
	}
	blob.prototype.init=function(){
		this.loaded=0;
		this.speed={};
		this.start=new Date();
		this.end=null;
	};
	var calcSpeed=function(blob){
		var now = new Date();
		if(!blob._markLoaded){
			blob._markLoaded=0;
			blob._markTime=blob.start;
		}
		if(now==blob._markTime){
			return;
		}
		var speed=blob.speed;
		var current=(blob.loaded-blob._markLoaded)/((now-blob._markTime)/1000);
		if(typeof(speed.max)=="undefined"){
			speed.max=current;
			speed.min=current;
		}else{
			speed.max=Math.max(speed.max,current);
			speed.min=Math.min(speed.min,current);
		}
		speed.current=current;
		speed.average=blob.loaded/((now-blob.start)/1000);
		blob._markLoaded=blob.loaded;
		blob._markTime=now;

	};
	blob.prototype.send=function(beforeSend,progress,success,error){
		var $t=this;
		$t.blocks=[];
		$t.loaded=0;
		$t.committing=false;
		var blockSuccess=function(){
			for (var i = $t.blocks.length - 1; i >= 0; i--) {
				if($t.blocks[i].status!='success'){
					return;
				}
			};
			$t.commit(success,error);
		}
		var blockError=function(xhr, desc, err){
			if(error){
				error.call($t,xhr, desc, err)
			}
		}
		var blockProgress=function(ev){
			if (progress) {
				$t.loaded=0;
				for (var i = $t.blocks.length - 1; i >= 0; i--) {
					$t.loaded+=	$t.blocks[i].loaded|0;
				};
				calcSpeed($t);
				progress.call($t,ev)				
			};
		}
		var blockBeforeSend=function(xhr){
			$t.start= new Date();
			if(beforeSend){
				beforeSend.call($t,this,xhr);
			}
		}
		var csize=0;
		while(csize<this.size){
			var _block=new block(this,csize,this.blockSize);
			if(csize==0){
				$t.init();
				_block.send(blockBeforeSend,blockProgress,blockSuccess,blockError);
			}else{
				_block.send(null,blockProgress,blockSuccess,blockError);				
			}
			csize+=this.blockSize;
		}
	};
	blob.prototype.commit=function(success,error){
		if(this.committing){
			return;
		}
		this.committing=true;
		var uri = this.url + '&comp=blocklist';
        var requestBody = '<?xml version="1.0" encoding="utf-8"?><BlockList>';
        for (var i = 0; i < this.blocks.length; i++) {
            requestBody += '<Latest>' + this.blocks[i].id + '</Latest>';
        }
        requestBody += '</BlockList>';
        var $t=this;
        $.ajax({
            url: uri,
            type: "PUT",
            data: requestBody,
            beforeSend: function (xhr) {
                xhr.setRequestHeader('x-ms-blob-content-type', this.type);
                xhr.setRequestHeader('Content-Length', this.size);
            },
            success: function (data, status) {
            	$t.status='success';
            	$t.end=new Date();
            	if(success){
            		success.call($t,data,status);
            	}
            },
            error: function (xhr, desc, err) {
            	$t.status='error';
            	$t.end=new Date();
            	if(error){
            		error.call($t,xhr,desc,err);
            	}
            }
        });
	};
	var block=function(blob,pointer,size){
		blob.blocks.push(this);
		this.blob =blob;
		this.pointer=pointer;
		this._preSize=size;
		this.id=btoa("block-"+pad(blob.blocks.length,6)).replace(/=/g,'a');
	};
	block.prototype.send=function(beforeSend,progress,success,error){
		var $t=this,blob=this.blob;
		var reader =new FileReader();
		reader.onloadend=function(ev){
			if (ev.target.readyState == FileReader.DONE) {
                var uri = blob.url + '&comp=block&blockid=' + $t.id;
                var requestData = new Uint8Array(ev.target.result);
                $.ajax({
                    url: uri,
                    type: "PUT",
                    data: requestData,
                    processData: false,
                    xhr: function () {  // Custom XMLHttpRequest
                        var myXhr = $.ajaxSettings.xhr();
                        if (myXhr.upload) { // Check if upload property exists
                            myXhr.upload.addEventListener('progress',  function(ev){
								if (ev.lengthComputable) {  
									$t.loaded=ev.loaded;
									$t.total=ev.total;
									if(progress){
										progress.call($t,ev)
									}
								}
							}, false); // For handling the progress of the upload
                        }
                        return myXhr;
                    },                    
                    beforeSend: function(xhr) {
                        xhr.setRequestHeader('x-ms-blob-type', 'BlockBlob');
                        xhr.setRequestHeader('Content-Length', $t.size);
                        if(beforeSend){
                        	beforeSend.call($t,xhr);
                        }
                    },
                    success: function (data, status) {
                        $t.status='success';
                        if(success){
                        	success.call($t,data,status);
                        }
                    },
                    error: function(xhr, desc, err) {
                    	$t.status='error';
                    	if(error){
                    		error.call($t,xhr,desc,err);
                    	}
                    }
                });
            }
		}

		var content=blob.file.slice(this.pointer,this.pointer+this._preSize);
		this.size=content.size;
		reader.readAsArrayBuffer(content);
	};
	$.widget('azure.blobuploader',{
		options:{
			url:null,
			blockSizeKB:1024,
			beforeSend:null,//function(blob)
			error:null,	//function(blob,xhr, desc, err)
			progress:null,//function(blob)
			success:null //function(blob,data,status)
		},
		_create:function(){
			
		},
		upload:function(){
			this.blobs=[];
			var $t=this,options=this.options;
			var blobBeforeSend=function(){
				if(options.beforeSend){
					options.beforeSend.call($t,this);
				}
			};
			var blobProgress=function(ev){
				if(options.progress){
					options.progress.call($t,this,ev)
				}
			};
			var blobSuccess=function(data,status){
				if(options.success){
					options.success.call($t,this,data,status);
				}
			};
			var blobError=function(xhr, desc, err){
				if(options.error){
					options.error.call($t,this,xhr, desc, err);
				}
			};
			this.element.find('input[type="file"]').each(function(){
				if($(this).val()){
					var _blob = new blob($(this),options.url,options.blockSizeKB*1024);
					$t.blobs.push(_blob);
					_blob.send(blobBeforeSend,blobProgress,blobSuccess,blobError);
				}
			})
			if(!this.blobs.length){
				throw "Please select file first.";
			}
		}
	});
})(jQuery);