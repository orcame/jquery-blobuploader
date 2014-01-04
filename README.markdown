This is jquery plugin used to upload file to azure storage. 

To use this plugin, you need:

+ a browser support HTML5
+ a azure blob account or container [sas](http://www.orcame.com/blog/2013/12/29/windows-azure-sas-introduce/) url
+ open the [CORS](http://blogs.msdn.com/b/windowsazurestorage/archive/2013/11/27/windows-azure-storage-release-introducing-cors-json-minute-metrics-and-more.aspx) of your storage account.


Quick view from [demo site](http://www.orcame.com/jquery-blobuploader)


	$('div').blobuploader({
		url:'your container sas url',
		maxThread:20,//the max thread, by default is 20
		blockSizeKB:2048//the block size, default is 2048, should be less than 4096
	});

	$('div').blobuploader('upload');//will upload all <input type='file'/> node's target file to your container


Options:

Name|Default|Description
---|---|---
url|null|your container sas url
blockSizeKB|4096|the max block size used to split a blobsuccessfully.
maxThread|7|the max ajax request at the same time. Default is 7 no why, I love the number.
retry|1|the times of automatic retry upload the failed block.(means upload retry+1 times)


Functions:

Name|Parameters|Description
---|---|---
upload|N/A|upload all <input type='file'/> node's target file
blob|element|get the blob instance by the input element(selector, Dom Node or jquery instance)
blobs|N/A|get the blob list.
retry|blob|retry upload the blob (no argument means all failed blobs), will skip all blocks that upload successfully.
reset|blob|reset the given blob (no argument means all blob) to the initialize status.(all block, include the upload successfully ones been removed). `reset+upload` means re-upload.

Events:

Name|Parameters|Description
---|---|---
beforeSend|blob|execute before you blob upload
progress|blob|execute while the blob uploading, you can got the uploaded data length by blob.loaded and the max data count by blob.size
success|blob,data,status|execute while the blob upload success.
error|blob,block,xhr,desc,err|execute if the blob upload failed, may be triggered multiple times, you can get all failed block by call blob.errorBlocks.

