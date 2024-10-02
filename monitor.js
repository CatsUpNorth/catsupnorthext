/* App State */
class AppState {
	constructor() {
		this.version			= '0.0.2';
		this.darkMode			= false;
		this.paused 			= false;
		this.state				= {};
		this.settingsSchema 	= {};
		this.passCache			= {}; // Password attempts by thread id
		this.contentCacheFC		= null; // Used to save the last chat sent for when users are doing a free chat.
		this.replyToCacheFC		= null; // Used to save the last chat sent for when users are doing a free chat.
		this.threadIdCacheFC	= null; // Used to save the last chat sent for when users are doing a free chat.
		this.newPassCacheFC		= null; // Used to save the last chat sent for when users are doing a free chat.
		this.settingsDefault 	= {
		    server_url:            			"https://catsupnorth.com", // fallback server url
			refresh_threads_microseconds:	60_000, // 1 minute
			refresh_chat_microseconds:		1000, // 0.5 seconds
			url_preview_max_len: 			40,
			min_spend_threshold: 			1,
			fiat_code: 						'USD',
			ignore_free_threads: 			false,
			ignore_free_chats: 				false,
		};
		this.settingsLimits 	= {
			refresh_threads_microseconds: 	[2500, 60000], // 2.5 seconds to 60 seconds
			refresh_chat_microseconds: 		[550, 5000],  // 0.55 seconds to 5 seconds
		};
		this.skipFeed 			= false; // skip feed message if true only once (set back to false just before feed method exits early)
		this.skipGetThreads 	= false; // skip loading threads if true only once (set back to false just before loadThreads method exits early)
		this.skipAutoScroll 	= false; // skip autoscroll if user is scrolling up in the chat.
		this.currentCaptcha 	= null;
		this.transactionCaptcha	= null; // set to captchaId when user initiates a super chat or a verified username purchase.
		this.followSearch		= null;
		this.newMessages 		= 0;
		this.conversionRates 	= [];
		for (let key in this.settingsDefault) this.settingsSchema[key] = typeof this.settingsDefault[key];
		this.settingsSchema.server_url = 'string';
		this.loadState();
	}

	pause() {
		this.paused = this.paused? false: true;
		const pause_link = document.getElementById('pause');
		if (pause_link) pause_link.style.opacity = this.paused? '1': '0.5';
	}

	// Load the state from chrome.storage.local
	loadState() {
		chrome.storage.local.get(['invoices', 'current_user_url', 'settings'], (result) => {
			if (chrome.runtime.lastError) {
				console.error('Error loading state:', chrome.runtime.lastError);
				return;
			}
			this.state.invoices 		= result.invoices 			|| {};
			this.state.current_user_url = result.current_user_url 	|| '';
			this.state.settings 		= result.settings 			|| {};

			if (Object.keys(this.state.settings).length < Object.keys(this.settingsDefault).length) {
				this.state.settings = JSON.parse(JSON.stringify(this.settingsDefault));
			}

			if(!this.currentCaptcha) this.currentCaptcha = Object.keys(this.state.invoices)[0] || null;

			this.rebuildSettingsForm();
			this.rebuildInvoiceList();
			this.updateConversionRates();
			this.startPolling();

			// Create the thread and chat refresh intervals
			try{
				chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => { 
					if (tabs.length > 0){
						this.updateCurrentUserURL(tabs[0].url, false);
						this.getThreads(this.state.current_user_url);
					}
				});
			}catch(e){
				// do nothing
			}
		});
	}
	
	startPolling(){
		try{
			clearInterval(window.thread_interval);
			clearInterval(window.chat_interval);
			clearInterval(window.rate_interval);
			window.thread_interval = null;
			window.chat_interval = null;
			window.rate_interval = null;
		}catch(e){
			console.error('Error starting polling:', e);
		}
		const thread_container = document.getElementById('thread_container');
		if(thread_container && !thread_container.classList.contains('thread')){
			this.getThreads();
		}
		var hardThreadInterval 	= this.getSetting('refresh_threads_microseconds');
			hardThreadInterval 	= (typeof hardThreadInterval != 'number' || hardThreadInterval < 6000)? 6000: hardThreadInterval;
		var hardChatInterval 	= this.getSetting('refresh_chat_microseconds');
			hardChatInterval 	= (typeof hardChatInterval != 'number' || hardChatInterval < 550)? 550: hardChatInterval;
		window.thread_interval = setInterval(() => {
			const thread_container = document.getElementById('thread_container');
			if(!thread_container) return;
			// if user is in chat mode, don't get threads
			if(thread_container.classList.contains('thread')) return;
			// refresh the chats
			this.skipFeed = true; // background polling should not update the feed
			this.getThreads();
		}, hardThreadInterval);
		window.chat_interval = setInterval(() => {
			const thread_container = document.getElementById('thread_container');
			if(!thread_container) return;
			// If the server url is not set, don't refresh
			if(!this.state.current_user_url) return;
			// if user is in thread mode, don't get chats
			if(!thread_container.classList.contains('thread')) return;
			// user is trying to reply to a chat, don't refresh
			if(document.getElementsByClassName('chat_reply_form_open').length > 0) return;
			// refresh the chats
			this.skipFeed = true; // background polling should not update the feed
			this.loadThread(this.getCurrentThreadID());
		}, hardChatInterval);
		window.rate_interval = setInterval(() => {
			if(this.paused) return;
			this.updateConversionRates();
		}, 6133); // 6.333 seconds (try to miss the other intervals)
	}

	// Save the current state to chrome.storage.local
	saveState() {

		this.state.my_invoice_ids = [];
		// Get all the invoices that have secrets and get the ID from the start of the string
		for (let name in this.state.invoices) {
			if(this.state.invoices[name].secret && typeof this.state.invoices[name].secret == 'string' && this.state.invoices[name].secret.length > 0){
				var invoice = this.state.invoices[name];
				if(!('repo' in invoice) || !invoice.repo || typeof invoice.repo != 'string' || invoice.repo.length < 3) continue
				var repo_split = invoice.repo.split(' ');
				if(repo_split.length < 1 || isNaN(repo_split[0]*1)) continue;
				this.state.my_invoice_ids.push(repo_split[0]*1);
			}
		}

		chrome.storage.local.set(this.state, () => {
			if (chrome.runtime.lastError) {
				console.error('Error saving state:', chrome.runtime.lastError);
			}
		});

		const server_url = this.getSetting('server_url');
		if(!server_url || typeof server_url != 'string' || server_url.length < 1) return;
		document.getElementById('server_link').href 		= server_url + '';
		document.getElementById('server_link').textContent 	= server_url.replace(/https?:\/\//, '');

		this.startPolling();
	}

	cachePass(thread_id, pass) { // TODO: Create a modal with input masking
		this.passCache[`t${thread_id}`] = pass;
		return pass;
	}

	getCachedPass(thread_id = null) {
		if(isNaN(thread_id*1) || !(`t${thread_id}` in this.passCache)) return null;
		return this.passCache[`t${thread_id}`];
	}
	
	// Saves invoice to state
	addInvoice(captcha, secret, val, curr, repo){
		this.state.invoices[captcha] = {
			secret:			secret,
			satoshi_paid: 	0,
			btc_paid:		'0.0',
			repo:			repo,
			balance:		0, // satoshi remaining
			conv_balance:	0, // dollar value of balance
			created:		new Date().toISOString(),
			tokens:			0, // total api calls awarded
			rate_quote:		0,
			val:			val,
			curr:			curr,
			link:			null,
			server_url:		this.getSetting('server_url'),
		};
		document.getElementById('recovery_phrase').value = '';
		this.saveState();
		this.rebuildInvoiceList();
	}
	
	buyKeys(val, curr) {
		const server_url = this.getSetting('server_url');
		if (!server_url || typeof server_url != 'string' || server_url.length < 1) {
			this.feed('Error: Server URL not set.', true);
			return;
		}
		const buyEndpoint 	= `${server_url}/buy?val=${encodeURIComponent(val)}&cur=${encodeURIComponent(curr)}`;
		fetch(buyEndpoint)
			.then(response => {
				if (response.ok) {
					return response.text();
				} else {
					throw new Error('Network response was not ok');
				}
			})
			.then(json => { //  Expected: { "captcha_id": None, "secret": None, "error": None }
				const data = typeof json == 'string'? JSON.parse(json): json;
				if(!data || typeof data != 'object'){
					this.feed('Server response parse failed.', true);
					return;
				}
				const captchaId 		= data.captcha_id 		|| null;
				const secret			= data.secret			|| null;
				const error 			= data.error			|| null;
				const recovery_phrase	= data.recovery_phrase	|| null;
				if (error) {
					this.feed(`Error: ${error}`, true);
					return;
				}
				if (!captchaId) {
					this.feed('Error: No captcha ID received.', true);
					return;
				}
				if (!secret) {
					this.feed('Error: No secret received.', true);
					return;
				}
				this.addInvoice(captchaId, secret, val, curr, recovery_phrase);
				this.saveState();
				this.rebuildInvoiceList();
				this.feed(`Received Captcha ID: ${captchaId}`);
				
				// Create a form dynamically
				const form = document.createElement('form');
				form.method = 'POST';
				const server_url = this.getSetting('server_url');
				if (!server_url || typeof server_url != 'string' || server_url.length < 1) {
					this.feed('Error: Server URL not set.', true);
					return;
				}
				form.action = `${server_url}/request_invoice_creation`;
				form.target = '_blank';

				// Create an input element for the captcha ID
				const input = document.createElement('input');
				input.type = 'hidden';
				input.name = 'captcha_id';
				input.value = captchaId;

				// Create in input element for the secret
				const secretInput = document.createElement('input');
				secretInput.type = 'hidden';
				secretInput.name = 'secret';
				secretInput.value = secret;

				// Append the input to the form, append the form to the body (needed for submission), submit, and then remove.
				form.appendChild(input);
				form.appendChild(secretInput);
				document.body.appendChild(form);
				this.skipGetThreads = true;
				form.submit();
				document.body.removeChild(form);
			})
			.catch(error => {
				this.feed('There has been a problem with your fetch operation. See console.', true);
				console.error(error);
			})
	}

	recoverInvoice(form){
		const server_url  		= this.getSetting('server_url');
		if (!server_url || typeof server_url != 'string' || server_url.length < 1) {
			this.feed('Error: Server URL not set.', true);
			return;
		}	
		const recoverEndpoint 	= `${server_url}/recover_invoice`;
		const formObj			= new FormData(form);
		fetch(recoverEndpoint, {
			method: 'POST',
			body: formObj
		})
		.then(response => {
			
			if (response.ok) {
				return response.text();
			} else {
				throw new Error('Network response was not ok');
			}
		})
		.then(json => {
			
			const data = typeof json == 'string'? JSON.parse(json): json;
			if(!data || typeof data != 'object'){
				this.feed('Server response parse failed.', true);
				return;
			}
			if (data.error) {
				this.feed(`Error: ${data.error}`, true);
			} else {
				this.feed(data.msg);
				this.addInvoice(data.captcha_id, data.secret, data.face_value, data.face_currency, document.getElementById('recovery_phrase').value);
				this.saveState();
				this.redeemInvoice(data.captcha_id);
				this.feed(data.msg);
			}
		})
		.catch(error => {
			this.feed('There has been a problem with your fetch operation. See console.', true);
			console.error(error);
		});
	}

	deleteNoLinkInvoices(){
		for (let name in this.state.invoices) {
			if(!this.state.invoices[name].link || this.state.invoices[name].link.length < 1){
				delete this.state.invoices[name];
			}
		}
		this.saveState();
		this.rebuildInvoiceList();
	}

	rollupInvoices(form){
		const server_url  		= this.getSetting('server_url');
		if (!server_url || typeof server_url != 'string' || server_url.length < 1) {
			this.feed('Error: Server URL not set.', true);
			return;
		}
		const recoverEndpoint 	= `${server_url}/recover_invoice`;
		const formObj			= new FormData(form);
		return null;
	}

	// Create a thread
	createThread(captcha_id, description, password, css, channel = null) {
		if(this.paused) return;
		this.sendChat(captcha_id, description, 0, 0, 0, password, css, channel);
	}

	// send chat or create threda (reply_to is zero)
	sendChat(captcha_id, content, reply_to = 0, thread_id = 0, spend = 0, password = null, css = null, channel = null) {
		if(this.paused) return;

		// Save these just in case the user needs to complete a captcha
		this.contentCacheFC 	= content.toString() + "";
		this.replyToCacheFC 	= reply_to*1;
		this.threadIdCacheFC 	= thread_id*1;
		this.currentCaptcha 	= captcha_id;
		this.newPassCacheFC 	= password;

		document.querySelectorAll('.superchat_input').forEach(   (input) => { input.value = ''; } );
		document.querySelectorAll('.superchat_satoshi').forEach( (input) => { input.value = 0;  } );
		const currentURL 	= this.getCurrentURL();
		const server_url 	= this.getSetting('server_url');
		if (!server_url || typeof server_url != 'string' || server_url.length < 1) {
			this.feed('Error: Server URL not set.', true);
			return;
		}
		const chatEndpoint 	= `${server_url}/send_chat`;
		const formData 		= new FormData();
		if(captcha_id != 'free'){ // can be null for free chat
			formData.append('captcha_id', captcha_id);
			formData.append('secret', this.state.invoices[captcha_id].secret);
			formData.append('spend', spend);
			if(spend && !isNaN(spend*1) && spend > 0) this.transactionCaptcha = captcha_id;
		}
		formData.append('content', content.toString());
		formData.append('url', currentURL);
		formData.append('reply_to', reply_to);
		formData.append('thread_id', thread_id);
		formData.append('css', css);
		formData.append('channel', channel);
		if(!reply_to){
			for(var prop in this.state.current_metadata){ // New thread, send URL metadata for card creation
				if(!prop || prop.length < 1) continue;
				formData.append(`metadata_${prop}`, this.state.current_metadata[prop] || '');
			}
			if(password){ // Don't send cached password if it's a new thread
				formData.append('password', password);
			}
		}else{
			if(!password && thread_id) password = this.getCachedPass(thread_id);
			formData.append('password', password);
		}

		// empty the cross_post_container
		document.getElementById('cross_post_container').innerHTML = '';

		fetch(chatEndpoint, {
			method: 'POST',
			body: formData
		})
		.then(response => {
			
			if (response.ok) {
				return response.text();
			} else {
				throw new Error('Network response was not ok');
			}
		})
		.then(json => {
			
			const data = typeof json == 'string'? JSON.parse(json): json;
			if(!data || typeof data != 'object'){
				this.feed('Server response parse failed.', true);
				return;
			}
			if (data.error) {
				this.feed(`Error: ${data.error}`, true);
			} else {
				const msg = data?.msg || 'Message sent.';
				this.feed(msg);
			}
			
			// If the user is sending a free chat, they must complete a captcha.
			// Free chats are sent to another endpoint that validates the captcha.
			if("image_data" in data && data.image_data){
				const tmpCaptcha 	= data?.captcha_id || null;
				const tmpMsg 		= data?.msg || 'Please complete the captcha to send your message.';
				this.feed(tmpMsg);
				// Create a form at the bottom of the home tab
				const captchaForm = document.createElement('form');
				captchaForm.classList.add('free_chat_captcha_form');
				const captchaIdHidden = document.createElement('input');
				captchaIdHidden.type = 'hidden';
				captchaIdHidden.name = 'captcha_id';
				captchaIdHidden.value = tmpCaptcha;
				const captchaImg = document.createElement('img');
				captchaImg.src = data.image_data.startsWith("data:image/png;base64,")? data.image_data: `data:image/png;base64,${data.image_data}`;
				captchaImg.style.width = '100%';
				captchaImg.style.maxWidth = '100%';
				const captchaInput = document.createElement('input');
				captchaInput.type = 'text';
				captchaInput.name = 'human_guess';
				captchaInput.placeholder = 'Enter the captcha';
				const captchaSubmit = document.createElement('input');
				captchaSubmit.type = 'submit';
				captchaSubmit.value = 'Submit';
				captchaForm.appendChild(captchaIdHidden);
				captchaForm.appendChild(captchaImg);
				captchaForm.appendChild(document.createElement('br'));
				captchaForm.appendChild(document.createElement('br'));
				captchaForm.appendChild(captchaInput);
				captchaForm.appendChild(captchaSubmit);
				captchaForm.addEventListener('submit', (event) => {
					event.preventDefault();
					const formData = new FormData(event.currentTarget);

					// Saved for captcha use
					formData.append('content', this.contentCacheFC);
					formData.append('reply_to', this.replyToCacheFC);
					formData.append('thread_id', this.threadIdCacheFC);
					formData.append('password', this.newPassCacheFC);
					
					formData.append('url', this.getCurrentURL());

					for(var prop in this.state.current_metadata){ // New thread, send URL metadata for card creation
						if(!prop || prop.length < 1) continue;
						formData.append(`metadata_${prop}`, this.state.current_metadata[prop] || '');
					}
					this.contentCacheFC = null;
					this.replyToCacheFC = null;
					this.threadIdCacheFC = null;
					this.newPassCacheFC = null;
					const server_url = this.getSetting('server_url');
					if (!server_url || typeof server_url != 'string' || server_url.length < 1) {
						this.feed('Error: Server URL not set.', true);
						return;
					}
					const freeChatEndpoint = `${server_url}/send_chat_free`;
					// delete free_chat_captcha_form
					document.querySelectorAll('.free_chat_captcha_form').forEach((form) => { form.remove(); });
					fetch(freeChatEndpoint, {
						method: 'POST',
						body: formData
					})
					.then(response => {
						
						if (response.ok) {
							return response.text();
						} else {
							throw new Error('Network response was not ok');
						}
					})
					.then(json => {
						
						const data = typeof json == 'string'? JSON.parse(json): json;
						if(!data || typeof data != 'object'){
							this.feed('Server response parse failed.', true);
							return;
						}
						if (data.error) {
							this.feed(`Error: ${data.error}`, true);
						} else {
							const msg = data?.msg || 'Message sent.';
							this.feed(msg);
							this.startPolling();
						}
					})
					.catch(error => {
						this.feed('There has been a problem with your fetch operation. See console.', true);
						console.error(error);
					});
				});
				document.getElementById('home').appendChild(captchaForm);
				captchaInput.focus();
			}


			const create_thread_form = document.getElementById('create_thread_form');
			var currentThreadId = this.getCurrentThreadID();
			if(currentThreadId){
				this.skipFeed = true;
				this.loadThread(currentThreadId,this.getCachedPass(currentThreadId));
			}else if(create_thread_form.style.display !== 'none'){
				document.getElementById('create_thread_toggle_link').click();
				document.getElementById('thread_content_input').value = '';
				this.skipFeed = true;
				this.getThreads();
			}else{
				this.feed("ERROR: Thread ID not found.", true);
			}
		})
		.catch(error => {
			this.feed('There has been a problem with your post operation. See console.', true);
			console.error(error);
		});
	}

	isFollowing(alias){
		try{
			const invoice = this.state.invoices[this.currentCaptcha];
			if(!invoice || !('follows' in invoice) || !Array.isArray(invoice.follows)) return false;
			return invoice.follows.indexOf(alias) > -1;
		}catch(e){
			return false;
		}
		return false;
	}

	updateFollowList(captchaId = null){
		if(this.paused) return;
		this.followSearch = captchaId;
		const formData = new FormData();
		formData.append('captcha_id', captchaId);
		formData.append('secret', this.getInvoiceSecret(captchaId));
		const server_url = this.getSetting('server_url');
		if (!server_url || typeof server_url != 'string' || server_url.length < 1) {
			this.feed('Error: Server URL not set.', true);
			return;
		}
		const getFollowsEndpoint = `${server_url}/get_my_follows`;
		fetch(getFollowsEndpoint, {
			method: 'POST',
			body: formData
		})
		.then(response => {
			
			if (response.ok) {
				return response.text();
			} else {
				throw new Error('Network response was not ok');
			}
		})
		.then(json => {
			
			const data = typeof json == 'string'? JSON.parse(json): json;
			const invoice = this.followSearch in this.state.invoices? this.state.invoices[this.followSearch]: null;
			if(invoice) invoice.follows = data?.follows || [];
			this.rebuildFollowList();
		})
		.catch(error => {
			
			this.feed('There has been a problem with your fetch operation. See console.', true);
			console.error(error);
		});
	}

	rebuildFollowList(){
		const followContainer 		= document.getElementById('follow_container');
		const serverURL 			= this.getSetting('server_url');
		if(!followContainer || !serverURL) return;
		followContainer.innerHTML 	= '';
		for(let captchaId in this.state.invoices){
			const invoice = this.state.invoices[captchaId];
			const followHeader = document.createElement('h6');
			var captchaName = captchaId.substring(0, 8) + '...';
			if('alias' in invoice && invoice.alias && typeof invoice.alias == 'string' && invoice.alias.length > 0) captchaName = invoice.alias;
			followHeader.textContent = `Follows for ${captchaName}`;
			followContainer.appendChild(followHeader);
			if(!invoice || !('follows' in invoice) || !Array.isArray(invoice.follows)){
				const noFollows = document.createElement('p');
				noFollows.textContent = 'No follows found.';
				followContainer.appendChild(noFollows);
				continue;
			}
			const followList = document.createElement('ul');
			followList.classList.add('follow_list');
			invoice.follows.forEach((follow) => {
				const followItem = document.createElement('li');
				const followLink = document.createElement('a');
				followLink.href = `${serverURL}/${follow}`;
				followLink.target = '_blank';
				followLink.textContent = follow;
				followItem.classList.add('follow_item');
				followItem.appendChild(followLink);
				followList.appendChild(followItem);
			});
			followContainer.appendChild(followList);
		}
	}
	
	reactDiv(chat_id, chat_alias = null, timestamp = null, is_me = false){
		var alias_str = (chat_alias && typeof chat_alias == 'string')? `${chat_alias}`: '';
		const container = document.createElement('span');
		var date_str = '';
		if(timestamp && typeof timestamp == 'string' && timestamp.length > 0){
			// Attempt to parse the timestamp and reformat as date + timezone
			try{
				const dateObj = new Date(timestamp);
				date_str = dateObj.toLocaleDateString() + ' ' + dateObj.toLocaleTimeString([], {
					hour: '2-digit',
					minute: '2-digit'
				});
			}catch(e){
				date_str = timestamp.split(" ");
				date_str = date_str.length > 5? date_str[0] + ' ' + date_str[1] + ' ' + date_str[2] + ' ' + date_str[3] + ' ' + date_str[5]: date_str.join(" ");
			}
		}
		container.append(document.createElement('br'));
		if(is_me){
			const meSpan = document.createElement('span');
			meSpan.innerHTML = 'Me&nbsp;-';
			meSpan.style.fontWeight = 'bold';
			container.appendChild(meSpan);
		}else{
			if(alias_str.startsWith('$')){
				const followLink 		= document.createElement('a');
				const iFollow 			= this.isFollowing(alias_str);
				const followVerb 		= iFollow? 'Unfollow': 'Follow';
				followLink.href 		= '#';
				followLink.innerHTML	= this.heroicon('user-plus').outerHTML + '&nbsp;' + followVerb;
				followLink.title 		= `${followVerb} user ${alias_str}`;
				followLink.setAttribute('data-alias', alias_str);
				followLink.setAttribute('data-unfollow', (iFollow? 'yes': 'no'));
				followLink.addEventListener('click', (event) => {
					event.preventDefault();
					if(this.paused) return;
					const targ		= event.currentTarget;
					const formData 	= new FormData();
					formData.append('verified_username_follow', targ.getAttribute('data-alias'));
					formData.append('unfollow', targ.getAttribute('data-unfollow'));
					formData.append('captcha_id', this.currentCaptcha);
					formData.append('secret', this.getInvoiceSecret(this.currentCaptcha));
					const server_url = this.getSetting('server_url');
					if (!server_url || typeof server_url != 'string' || server_url.length < 1) {
						this.feed('Error: Server URL not set.', true);
						return;
					}
					const followEndpoint = `${server_url}/follow`;
					fetch(followEndpoint, {
						method: 'POST',
						body: formData
					})
					.then(response => {
						
						if (response.ok) {
							return response.text();
						} else {
							throw new Error('Network response was not ok');
						}
					})
					.then(json => {
						
						const data = typeof json == 'string'? JSON.parse(json): json;
						if(!data || typeof data != 'object'){
							this.feed('Follow operation failed.', true);
							return;
						}
						if (data.error) {
							this.feed(`Error: ${data.error}`, true);
						} else {
							this.feed(data.msg);
							this.updateFollowList(this.currentCaptcha);
						}
					})
					.catch(error => {
						this.feed('There has been a problem with your fetch operation. See console.', true);
						console.error(error);
					});
				});
				container.appendChild(followLink);
			}else{
				const anonSpan = document.createElement('span');
				anonSpan.innerHTML = 'Anon&nbsp;-';
				anonSpan.style.fontWeight = 'bold';
				container.appendChild(anonSpan);
			}
		}
		const chatInfo = document.createElement('span');
		chatInfo.innerHTML = `&nbsp;${alias_str}<br>${date_str}`;
		chatInfo.classList.add('chat_info');
		container.appendChild(chatInfo);
		const heightFixer = document.createElement('span');
		heightFixer.classList.add('reaction_height_fixer');
		heightFixer.innerHTML = '&nbsp;';
		heightFixer.style.paddingRight = '5px';
		container.classList.add('reaction_container');
		const linkSpan = document.createElement('span');
		linkSpan.classList.add('reaction_link_span');
		linkSpan.classList.add('pull-right');
		const likeButton = document.createElement('a');
		likeButton.href = '#';
		likeButton.classList.add('reaction_button');
		likeButton.classList.add('like_button');
		likeButton.innerHTML = this.heroicon('hand-thumb-up').outerHTML;
		likeButton.setAttribute('data-chat-id', chat_id);
		likeButton.style.paddingRight = '5px';
		likeButton.style.paddingLeft = '5px';
		const likeCount = document.createElement('span');
		likeCount.classList.add('reaction_count');
		likeCount.classList.add('like_count');
		likeCount.textContent = '0';
		likeCount.setAttribute('data-chat-id', chat_id);
		const dislikeButton = document.createElement('a');
		dislikeButton.href = '#';
		dislikeButton.classList.add('reaction_button');
		dislikeButton.classList.add('dislike_button');
		dislikeButton.innerHTML = this.heroicon('hand-thumb-down').outerHTML;
		dislikeButton.setAttribute('data-chat-id', chat_id);
		dislikeButton.style.paddingRight = '5px';
		dislikeButton.style.paddingLeft = '5px';
		const dislikeCount = document.createElement('span');
		dislikeCount.classList.add('reaction_count');
		dislikeCount.classList.add('dislike_count');
		dislikeCount.textContent = '0';
		dislikeCount.setAttribute('data-chat-id', chat_id);
		likeButton.appendChild(likeCount);
		dislikeButton.appendChild(dislikeCount);
		linkSpan.appendChild(heightFixer);
		linkSpan.appendChild(likeButton);
		linkSpan.appendChild(dislikeButton);
		const chatIdSpan = document.createElement('span');
		chatIdSpan.style.opacity = '0.4';
		chatIdSpan.innerHTML = `#${chat_id}`;
		container.appendChild(document.createElement('br'));
		container.appendChild(chatIdSpan);
		container.appendChild(linkSpan);
		container.appendChild(document.createElement('br'));
		return container;
	}

	getInvoiceSecret(captcha_id){
		return (this.state.invoices?.[captcha_id] || {})?.secret || null;
	}

	updateReactions(reactions){
		if(!reactions || !Array.isArray(reactions)) return;
		const frozenContainer = document.getElementById('frozen_container');
		if(frozenContainer){
			const frozenReactionCounts = frozenContainer.querySelectorAll('.reaction_count');
			if(frozenReactionCounts){
				frozenReactionCounts.forEach((count) => {
					count.textContent = '0';
				});
			}
		}

		// Get invoice_ids for invoices that have secrets
		if(this.state.my_invoice_ids.length <= 0){ // User cannot react without a secret
			const likeButtons = document.querySelectorAll('.reaction_button');
			likeButtons.forEach((button) => {
				button.addEventListener('click', (event) => {
					event.preventDefault();
					this.feed('You must have an wallet secret to react to threads and chats.', true);
				});
			});
			return;
		};

		for (var i=0; i<reactions.length; i++){ // label my reactions
			const reaction = reactions[i];
			if(!reaction || typeof reaction != 'object' || !('chat_ref_id' in reaction) || !('vote' in reaction) || !('invoice_ref_id' in reaction)) continue;
			try{
				const chatId = reaction.chat_ref_id;
				const vote = reaction.vote;
				const inv = reaction.invoice_ref_id*1;
				switch(vote.toString().toLowerCase()){
					case 'up':
						var btn = document.querySelector(`.like_button[data-chat-id="${chatId}"]`);
						var cnt = document.querySelector(`.like_count[data-chat-id="${chatId}"]`);
						if(cnt && !isNaN(cnt.textContent*1)) cnt.textContent = (cnt.textContent*1 + 1).toString();
						if(this.state.my_invoice_ids.indexOf(inv) > -1) btn.classList.add('my_reaction');
						break;
					case 'down':
						var btn = document.querySelector(`.dislike_button[data-chat-id="${chatId}"]`);
						var cnt = document.querySelector(`.dislike_count[data-chat-id="${chatId}"]`);
						if(cnt && !isNaN(cnt.textContent*1)) cnt.textContent = (cnt.textContent*1 + 1).toString();
						if(this.state.my_invoice_ids.indexOf(inv) > -1) btn.classList.add('my_reaction');
						break;
					default:;
				}
			}catch(e){
				console.error(e);
				continue;
			}
		}

		// Add event listeners to reaction buttons
		const likeButtons = document.querySelectorAll('.reaction_button');
		likeButtons.forEach((button) => {

			// clone and replace button to remove event listeners
			const clonedButton = button.cloneNode(true);
			button.parentNode.replaceChild(clonedButton, button);

			clonedButton.addEventListener('click', (event) => {
				event.preventDefault();
				if(this.paused) return;
				if(event.currentTarget.classList.contains('my_reaction')) return; // user already reacted
				event.currentTarget.classList.add('my_reaction');
				const counter = event.currentTarget.querySelector('.reaction_count');
				if(counter.classList.contains('reaction_count') && !isNaN(counter.textContent*1)){
					// preemtively increment the counter
					counter.textContent = (counter.textContent*1 + 1).toString();
				}

				// If the user liked and had already disliked, remove the dislike
				const findClass = event.currentTarget.classList.contains('like_button')? 'dislike_button': 'like_button';
				const sibling = event.currentTarget.parentElement.querySelector(`.reaction_button.${findClass}`);
				if(sibling && sibling.classList.contains('my_reaction')){
					sibling.classList.remove('my_reaction');
					const siblingCounter = sibling.querySelector('.reaction_count');
					if(siblingCounter.classList.contains('reaction_count') && !isNaN(siblingCounter.textContent*1) && siblingCounter.textContent*1 > 0){
						siblingCounter.textContent = (siblingCounter.textContent*1 - 1).toString();
					}
				}
				const server_url = this.getSetting('server_url');
				if (!server_url) {
					this.feed('Server URL not set.', true);
					return;
				}
				const reactEndpoint = `${server_url}/chat_react`;
				const formData = new FormData();
				const chatId = event.currentTarget.getAttribute('data-chat-id');
				const reaction = event.currentTarget.classList.contains('like_button')? 'up': 'down';
				formData.append('chat_id', chatId);
				formData.append('vote', reaction);
				formData.append('captcha_id', this.currentCaptcha);
				formData.append('secret', this.getInvoiceSecret(this.currentCaptcha));
				fetch(reactEndpoint, {
					method: 'POST',
					body: formData
				})
				.then(response => {
					
					if (response.ok) {
						return response.text();
					} else {
						throw new Error('Network response was not ok');
					}
				})
				.then(json => {
					
					const data = typeof json == 'string'? JSON.parse(json): json;
					if(!data || typeof data != 'object'){
						this.feed('Server response parse failed.', true);
						return;
					}
					if (data.error) {
						this.feed(`Error: ${data.error}`, true);
					} else {
						this.feed(data.msg);
					}
				})
				.catch(error => {
					this.feed('There has been a problem with your fetch operation. See console.', true);
					console.error(error);
				});
			});
		});
	}

	loadThread(threadId, password = null){
		if(this.paused) return;
		const startMode = document.querySelectorAll('.chat').length > 0? false: true;
		threadId = threadId || this.getCurrentThreadID();
		document.getElementById('create_thread_container').style.display = 'none';
		document.getElementById('back_to_threads_bracket').style.display = 'inline-block';
		// TODO Change to post to allow for password and css
		const threadContainer = document.getElementById('thread_container');
		const frozenThreadContainer = document.getElementById('frozen_thread_container');
		// change to post
		const formData = new FormData();
		formData.append('thread_id', threadId);
		if (password) formData.append('password', password);
		const server_url = this.getSetting('server_url');
		if (!server_url) {
			this.feed('Server URL not set.', true);
			return;
		}
		const threadEndpoint = `${server_url}/get_thread_chats`;

		var latestDateSubmitted = null;
		if(startMode){
			threadContainer.innerHTML = '';
		}else{
			const chatDivs = document.querySelectorAll('#thread_container .chat');
			if(chatDivs){
				// Get the last node from query selector
				const lastChatDiv = chatDivs[chatDivs.length - 1];
				if (lastChatDiv && lastChatDiv.getAttribute('data-date-submitted')) latestDateSubmitted = lastChatDiv.getAttribute('data-date-submitted');
			}
		}
		if(latestDateSubmitted){
			formData.append('date_submitted_after', latestDateSubmitted);
		}
		if(this.currentCaptcha){
			formData.append('captcha_id', this.currentCaptcha);
			formData.append('secret', this.getInvoiceSecret(this.currentCaptcha));
		}
		fetch(threadEndpoint, {
			method: 'POST',
			body: formData
		})
		.then(response => {
			if (response.ok) {
				return response.text();
			} else {
				throw new Error('Network response was not ok');
			}
		})
		.then(json => {
			document.getElementById('scroll_to_bottom_container').style.display = 'block';
			const data = typeof json == 'string'? JSON.parse(json): json;
			if(!data || typeof data != 'object'){
				this.feed('Server response parse failed.', true);
				return;
			}
			if (data.error) {
				this.feed(`Error: ${data.error}`, true);
				return;
			}
			this.feed(data.msg);
			const threadChats = data.chats;
			threadContainer.classList.add('thread');
			threadChats.forEach( chat => {
				const isMe = chat?.is_me || false;
				const isFree = chat?.is_free || false;

				// Do not add chats that are already in the thread
				var selector = `.chat[data-id="${chat.chat_id}"]`;
				var existingChat = document.querySelector(selector);
				if(existingChat) return; // chat already rendered

				selector = `.thread[data-id="${chat.chat_id}"]`;
				var existingParentChat = document.querySelector(selector);
				if(existingParentChat) return; // chat already rendered

				if(this.skipAutoScroll) this.newMessages++;

				const chatDiv = document.createElement('div');
				if(isFree) chatDiv.classList.add('free_chat');
				chatDiv.setAttribute('data-id', `${chat.chat_id}`);
				chatDiv.setAttribute('data-reply-to-id', `${chat.reply_to_id}`);
				chatDiv.setAttribute('data-date-submitted', `${chat.date_submitted}`);
				if(chat.reply_to_id){
					chatDiv.classList.add('chat');
				}else{
					chatDiv.classList.add('thread');
					chatDiv.classList.add('thread_parent_chat');
					chatDiv.style.boxShadow = 'none';
					chatDiv.style.border = 'none';
					chatDiv.style.backgroundColor = 'rgba(0,0,0,0)';
				}
				var superChatSpan = '';
				if(chat.superchat && !isNaN(chat.superchat*1) && chat.superchat > 0){
					chatDiv.classList.add('superchat');
					const fiatStr 	= this.satoshiToFiatStr(chat.superchat);
					const cryptoStr = this.satoshiToCryptoStr(chat.superchat);
					const star 		= this.heroicon('star').outerHTML || '⭐';
					superChatSpan += `<div class="superchat_amount">${star}&nbsp;&nbsp;${fiatStr}&nbsp;&nbsp;${star}&nbsp;&nbsp;${cryptoStr}&nbsp;&nbsp;${star}</div>`;
				}
				chatDiv.innerHTML = superChatSpan;
				if(isMe){
					const hasThreadClass = chatDiv.classList.contains('thread');
					chatDiv.classList.add((hasThreadClass? 'my_thread': 'my_chat'));
				}

				const chatContent = document.createElement('strong');
				// render utf chars as emojies
				chatContent.textContent = decodeHTMLEntities(chat.chat_content.toString());
				chatDiv.appendChild(chatContent);
				// Likes and dislikes
				const reactionContainer = this.reactDiv(chat.chat_id,chat.alias,chat.date_submitted,isMe);
				chatDiv.appendChild(reactionContainer);
				// cross post form
				const crossPostLink = document.createElement('a');
				crossPostLink.style.paddingLeft = '5px';
				crossPostLink.style.paddingRight = '5px';
				crossPostLink.href = '#';
				crossPostLink.classList.add('cross_post_link');
				crossPostLink.innerHTML  = this.heroicon('arrows-right-left').outerHTML || '';
				crossPostLink.innerHTML += ' XP';
				crossPostLink.title = 'Cross-Post this chat into another thread.';
				crossPostLink.setAttribute('data-chat-id', chat.chat_id);
				crossPostLink.addEventListener('click', (event) => {
					event.preventDefault();
					const chat_id = event.currentTarget.getAttribute('data-chat-id');
					const targetChatDiv = document.querySelector(`.chat[data-id="${chat_id}"]`);
					if(!targetChatDiv) return;
					const crossPostClone = targetChatDiv.cloneNode(true);
					crossPostClone.classList.add('cross_post_clone');
					crossPostClone.classList.remove('chat');
					crossPostClone.classList.remove('my_chat');
					const repliedTo = crossPostClone.querySelector('.replied_to_clone')
					const reactLink = crossPostClone.querySelector('.reaction_link_span');
					const replyForm = crossPostClone.querySelector('.reply_form');
					const xPostLink = crossPostClone.querySelector('.cross_post_link');
					if(repliedTo) repliedTo.remove();
					if(reactLink) reactLink.remove();
					if(replyForm) replyForm.remove();
					if(xPostLink) xPostLink.remove();
					const crossPostContainer = document.getElementById('cross_post_container');
					const crossPostCloneContainer = document.getElementById('cross_post_clone_container');
					if(!crossPostContainer || !crossPostCloneContainer) return;
					crossPostCloneContainer.innerHTML = `Cross Post Chat #${chat_id}`;
					crossPostCloneContainer.appendChild(crossPostClone);
					crossPostContainer.style.display = 'block';
				});
				// Reply Form and link to toggle reply form
				const replyLink = document.createElement('a');
				replyLink.style.paddingLeft = '5px';
				replyLink.style.paddingRight = '5px';
				replyLink.classList.add('chat_reply_link');
				replyLink.appendChild(this.heroicon('chat-bubble-bottom-center-text'));
				replyLink.appendChild(document.createTextNode(' Reply'));
				replyLink.href = '#';
				replyLink.addEventListener('click', (event) => {
					event.preventDefault();
					const cancel_xpost_link = document.getElementById('cancel_cross_post');
					if(cancel_xpost_link) cancel_xpost_link.click(); // User obviously doesn't want to cross post anymore
					const form = chatDiv.querySelector('.reply_form');
					form.style.display = form.style.display === 'none'? 'block': 'none';
					// focus on the first text input
					const textInput = form.querySelector('input[type="text"]');
					if(textInput) textInput.focus();
				});
				const replyForm = document.createElement('form');
				replyForm.style.display = 'none';
				replyForm.classList.add('reply_form');
				replyForm.setAttribute('data-chat-id', chat.chat_id);
				var sendSVG = this.heroicon('send');
				sendSVG = sendSVG? sendSVG.outerHTML: 'Send';
				var hideSVG = this.heroicon('eye-slash');
				hideSVG = hideSVG? hideSVG.outerHTML: 'PM';
				const fiatCode = this.getSetting('fiat_code');
				const fiatSymbol = this.fiatCodeToSymbol(fiatCode);
				replyForm.innerHTML = `
					<input type="hidden" name="thread_id" value="${threadId}">
					<select name="captcha_id" class="invoice_selector mini"></select>
					<input type="hidden" name="reply_to" value="${chat.chat_id}">
					<input type="text" data-chat-id="${chat.chat_id}" name="content" id="reply_text_input_${chat.chat_id}" class="chat_input" placeholder="Reply to chat, CTRL + Enter to send ₿">
					<div class="reply_form_super_chat_input_container hidden" id="spend_on_chat_${chat.chat_id}_container">
						&nbsp;&nbsp;${fiatSymbol}&nbsp;<input type="number" step="0.01" placeholder="Superchat in ${fiatCode}" class="superchat_input" id="dollars_on_chat_${chat.chat_id}" style="margin-top:6px;">
						<input type="hidden" name="spend" value="0" id="spend_on_chat_${chat.chat_id}" class="superchat_satoshi mini">
						<br>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span id="satoshi_str_on_chat_${chat.chat_id}"></span>
					</div>
					<br>&nbsp;<input type="submit" name="reply" value="" id="reply_text_submit_${chat.chat_id}" style="opacity:0;width:6px;height:28px;max-height:28px;margin-bottom:0;">`;

				// Create send links
				const replyLinkSpan = document.createElement('span');
				replyLinkSpan.classList.add('pull-right');
				const sendReplyLink = document.createElement('a');
				sendReplyLink.href = '#';
				sendReplyLink.classList.add('chat_reply_btn');
				sendReplyLink.classList.add('send_reply_btn');
				sendReplyLink.title = 'Send message!';
				sendReplyLink.innerHTML = sendSVG;
				sendReplyLink.style.marginTop = '5px';
				sendReplyLink.setAttribute('data-chat-id', chat.chat_id);
				sendReplyLink.addEventListener('click', (event) => {
					event.preventDefault();
					const chat_id = event.currentTarget.getAttribute('data-chat-id');
					document.getElementById(`reply_text_submit_${chat_id}`).click();
				});
				// const sendDMLink = document.createElement('a');
				// sendDMLink.href = '#';
				// sendDMLink.classList.add('chat_reply_btn');
				// sendDMLink.classList.add('send_dm_btn');
				// sendDMLink.title = 'Private Message';
				// sendDMLink.innerHTML = hideSVG;
				// sendDMLink.setAttribute('data-chat-id', chat.chat_id);
				const sendMoneyLink = document.createElement('a');
				sendMoneyLink.href = '#';
				sendMoneyLink.classList.add('chat_reply_btn');
				sendMoneyLink.classList.add('send_money_btn');
				// don't allow line breaks in sendMoneyLink
				sendMoneyLink.style.whiteSpace = 'nowrap';
				sendMoneyLink.title = 'Add Bitcoin to make this a super chat!';
				sendMoneyLink.style.fontSize = '18px';
				sendMoneyLink.innerHTML = `${fiatSymbol}|₿`;
				sendMoneyLink.setAttribute('data-chat-id', chat.chat_id);
				sendMoneyLink.addEventListener('click', (event) => {
					event.preventDefault();
					const chat_id = event.currentTarget.getAttribute('data-chat-id');
					const superChatContainer = document.getElementById(`spend_on_chat_${chat_id}_container`);
					superChatContainer.getElementsByTagName('input').item(0).value = "";
					superChatContainer.getElementsByTagName('input').item(1).value = 0;
					if(superChatContainer.classList.contains('hidden')){
						superChatContainer.classList.remove('hidden');
						const dollarsInput = document.getElementById(`dollars_on_chat_${chat_id}`);
						const clonedDollarsInput = dollarsInput.cloneNode(true);
						superChatContainer.replaceChild(clonedDollarsInput, dollarsInput);
						clonedDollarsInput.focus();
						clonedDollarsInput.addEventListener('input', (event) => {
							const satoshiInput = document.getElementById(`spend_on_chat_${chat_id}`);
							const satoshiStr = document.getElementById(`satoshi_str_on_chat_${chat_id}`);
							const dollars = event.target.value;
							if(dollars && !isNaN(dollars*1) && dollars*1 > 0){
								const satoshi 	= this.fiatToSatoshi(dollars);
								const cryptoStr = this.fiatToCryptoStr(dollars);
								satoshiInput.value = satoshi;
								satoshiStr.textContent = `${satoshi} sats | ${cryptoStr}`;
							}else{
								satoshiInput.value = 0;
								satoshiStr.textContent = '...';
							}
						});

					}else{ // Zero out the input and hide the container and focus on the text input
						superChatContainer.classList.add('hidden');
						document.getElementById(`reply_text_input_${chat_id}`).focus();
						const satoshiInput = document.getElementById(`spend_on_chat_${chat_id}`);
						const satoshiStr = document.getElementById(`satoshi_str_on_chat_${chat_id}`);
						satoshiInput.value = 0;
						satoshiStr.textContent = '...';
					}					
				});
				replyLinkSpan.appendChild(sendReplyLink);
				//replyLinkSpan.appendChild(sendDMLink);
				replyLinkSpan.appendChild(sendMoneyLink);
				replyForm.appendChild(replyLinkSpan);

				replyForm.addEventListener('submit', (event) => {
					event.preventDefault();
					const formData = new FormData(event.target);
					const formObject = {is_private: (event.submitter.name === 'private_reply' ? 1 : 0)};
					formData.forEach((value, key) => {
						formObject[key] = value;
					});

					// Clear the inputs
					const chat_id = event.target.getAttribute('data-chat-id');
					const textInput = event.target.querySelector('input[name="content"]');
					if (textInput) textInput.value = '';
					const spendInput = event.target.querySelector('input[name="spend"]');
					if (spendInput) spendInput.value = 0;
					const dollarsInput = document.getElementById(`dollars_on_chat_${chat_id}`);
					if (dollarsInput) dollarsInput.value = '';
					const satoshiStr = document.getElementById(`satoshi_str_on_chat_${chat_id}`);
					if (satoshiStr) satoshiStr.textContent = '...';
					const formParentDiv = event.target.parentElement;
					if(formParentDiv.classList.contains('chat')){
						formParentDiv.querySelector('.chat_reply_link').click();
					}
					
					// Check if there is a .cross_post_clone div
					const crossPostClone = document.querySelector('.cross_post_clone');
					if(crossPostClone){
						// Check if the crossPostClone has a chat ID that is in this thread.
						const crossPostChatId = crossPostClone.getAttribute('data-id');
						const crossPostChat = document.querySelector(`.chat[data-id="${crossPostChatId}"]`);
						if(crossPostChat){
							// block the cross post (it's already in the thread)
							this.feed('Cross post blocked. Chat already in thread.', true);
							// blink the cross post
							crossPostClone.style.backgroundColor = 'rgb(255,100,100)';
							setTimeout(() => {
								crossPostClone.style.backgroundColor = 'white';
							}, 1000);
							return;
						}else{
							formObject.reply_to = crossPostChatId;
						}
					}

					this.sendChat(formObject.captcha_id, formObject.content, formObject.reply_to, threadId, formObject.spend);
				});
				var heightFixer = reactionContainer.getElementsByClassName('reaction_height_fixer').item(0)
				heightFixer.innerHTML = "&nbsp;";
				if(chat.reply_to_id) heightFixer.append(crossPostLink)
				heightFixer.appendChild(replyLink);
				chatDiv.appendChild(replyForm);

				// check if cross post
				if(chat.thread_id != threadId){
					chatDiv.classList.add('cross_post');
					chatDiv.classList.remove('my_chat');
					chatDiv.classList.remove('superchat');
					const crossPostURL = document.createElement('a');
					crossPostURL.href = chat.url;
					crossPostURL.textContent = chat.url.length < 30? chat.url: chat.url.substring(0,30) + '...';
					crossPostURL.title = chat.url;
					crossPostURL.classList.add('cross_post_ext_link');
					crossPostURL.style.fontSize = '10px';
					// prepend crossPostURL to chatDiv
					chatDiv.insertBefore(document.createElement('br'), chatDiv.firstChild);
					chatDiv.insertBefore(crossPostURL, chatDiv.firstChild);
					// Add a thread id span
					const threadIdSpan = document.createElement('span');
					threadIdSpan.textContent = `X-Post from thread ${chat.thread_id}`;
					threadIdSpan.style.fontSize = '9px';
					threadIdSpan.style.opacity = '0.5';
					chatDiv.insertBefore(document.createElement('br'), chatDiv.firstChild);
					chatDiv.insertBefore(threadIdSpan, chatDiv.firstChild);
				}

				threadContainer.appendChild(chatDiv);
				setTimeout(load_invoice_selectors,50);
			});
			const newMsgPlur = this.newMessages == 1? '': 's';
			document.getElementById('new_msg_indicator').textContent = this.newMessages > 0? `${this.newMessages} New Message${newMsgPlur}`: 'Latest';
			this.updateReactions(data.reactions);

			// created embedded reply_to_clone divs
			const allChatDivs = threadContainer.querySelectorAll('.chat');
			allChatDivs.forEach((chatDiv) => {
				const childChats = chatDiv.querySelectorAll('.chat');
				if(childChats.length > 0) return;
				const replyToId = chatDiv.getAttribute('data-reply-to-id');
				const replyToDiv = document.querySelector(`.chat[data-id="${replyToId}"]`);
				if(!replyToDiv) return; // not a reply, move on
				if(chatDiv.querySelector('.replied_to_clone')) return; // already has a clone of the replied-to chat, move on
				// Clone the replied-to chat and prepend it to the current chatDiv
				const replyToClone = replyToDiv.cloneNode(true);
				replyToClone.classList.add('replied_to_clone');
				replyToClone.classList.remove('chat');
				replyToClone.removeAttribute('data-reply-to-id');
				replyToClone.removeAttribute('data-id');
				replyToClone.style.fontSize = '10px';

				// lock in the font color
				// replyToClone.querySelectorAll('span').forEach((span) => {
				// 	span.style.color = replyToClone.classList.contains('superchat')? 'white': 'black';
				// });
				// replyToClone.querySelectorAll('strong').forEach((strong) => {
				// 	strong.style.color = replyToClone.classList.contains('superchat')? 'white': 'black';
				// });

				// remove .reaction_link_span div from the clone
				const reactionLinkSpan = replyToClone.querySelector('.reaction_link_span');
				if(reactionLinkSpan) reactionLinkSpan.remove();

				// remove .replied_to_clone div from the clone if the clone itself is a reply
				const repliedToClone = replyToClone.querySelector('.replied_to_clone');
				if(repliedToClone) repliedToClone.remove();

				// superchat span
				const superChatSpan = replyToClone.querySelector('.superchat_amount');
				if(superChatSpan) superChatSpan.style.fontSize = '9px';

				// chat_info_span
				const chatInfoSpan = replyToClone.querySelector('.chat_info_span');
				if(chatInfoSpan) chatInfoSpan.style.fontSize = '7px';
				// remove .reply_form div from the clone
				const replyForm = replyToClone.querySelector('.reply_form');
				if(replyForm) replyForm.remove();

				chatDiv.insertBefore(replyToClone, chatDiv.firstChild);
			});

			if(startMode){
				const threadParentChat = threadContainer.querySelector('.thread_parent_chat');
				if(threadParentChat){
					const threadParentChatId = threadParentChat.getAttribute('data-id');
					// hide reply link
					const replyLink = threadParentChat.querySelector('.chat_reply_link');
					if(replyLink) replyLink.innerHTML = "&nbsp;";
					// show the form
					const replyForm = threadParentChat.querySelector('.reply_form[data-chat-id="' + threadParentChatId + '"]');
					if(replyForm){ // Remove the reply form from the first .thread and add it to the end of the threadContainer
						const textInput = replyForm.querySelector('input[name="content"]');
						if (textInput) textInput.placeholder = 'Reply to thread, CTRL + Enter to send ₿';
						const replyBtn = replyForm.querySelector('input[name="reply"]');
						if (replyBtn) replyBtn.value = 'Send';
						replyForm.remove();
						replyForm.style.display = 'block';
						frozenThreadContainer.appendChild(replyForm);

						// focus on the textInput
						textInput.focus();
					}
					// Remove the threadParentChat and put it into the frozenThreadContainer
					threadParentChat.remove();
					frozenThreadContainer.appendChild(threadParentChat);
				}

				document.querySelectorAll('.back_to_threads_link').forEach((link) => { link.remove(); });
				const backLink = document.createElement('a');
				backLink.textContent = '‹ Go back to threads';
				backLink.href = '#';
				backLink.classList.add('back_to_threads_link');
				backLink.addEventListener('click', (event) => {
					this.getThreads();
				});
				frozenThreadContainer.appendChild(backLink);
				document.querySelectorAll('.thread_label').forEach((label) => { label.remove(); });
				const threadLabel = document.createElement('strong');
				threadLabel.setAttribute('id', 'thread_label');
				threadLabel.innerHTML = `Thread <span id="cur_thread_id_container">${threadId}</span>`;
				threadLabel.classList.add('pull-right');
				threadLabel.classList.add('thread_label');
				frozenThreadContainer.appendChild(threadLabel);
				setTimeout(this.updateTCHeight,20);
			}else{
				const trd = threadContainer.querySelector('.thread');
				if(trd) trd.remove();
			}

			// scroll to btm of thread_container
			if(startMode || !this.skipAutoScroll){
				this.scrolldown();
			}

			// remove cross_posts from main body of chat
			const crossPosts = threadContainer.querySelectorAll('.cross_post');
			crossPosts.forEach((crossPost) => {
				if(!crossPost) return;
				if(crossPost.classList.contains('replied_to_clone')) return;
				crossPost.remove();
			});
		})
		.catch(error => {
			this.feed('There has been a problem with your fetch operation. See console.', true);
			console.error(error);
		})
		.finally(() => {
			// show user the change in balance
			if(this.transactionCaptcha){
				this.skipFeed = true;
				this.redeemInvoice(this.transactionCaptcha);
			}
		});
		setTimeout(this.updateTCHeight,20);
	}

	getCurrentThreadID(){
		const currentThreadIdContainer = document.getElementById('cur_thread_id_container');
		if(currentThreadIdContainer){
			const tid = currentThreadIdContainer.textContent;
			return !isNaN(tid*1)? tid*1: 0;
		}
		return 0;
	}

	getThreads(url_arg = null, metadata = null){
		if(this.paused) return;
		document.getElementById('scroll_to_bottom_container').style.display = 'none';
		document.getElementById('frozen_thread_container').innerHTML = '';
		document.getElementById('thread_container').classList.remove('thread');
		if(document.getElementById('cur_thread_id_container')) document.getElementById('cur_thread_id_container').remove();
		if(document.getElementById('thread_label')) document.getElementById('thread_label').remove();
		if(url_arg) this.updateCurrentUserURL(url_arg);
		if(metadata) this.updateCurrentMetadata(metadata);
		if(this.skipGetThreads){
			this.skipGetThreads = false;
			return;
		}
		document.getElementById('create_thread_container').style.display = 'inline-block';
		document.getElementById('back_to_threads_bracket').style.display = 'none';
		const url = this.getCurrentURL();
		if(!url){
			this.feed("No URL to fetch threads for.", true);
			return;
		}
		// send this to the get_threads endpoint
		const server_url = this.getSetting('server_url');
		if(!server_url){
			this.feed("No server URL set.", true);
			return;
		}
		const getThreadsURL = `${server_url}/get_threads`;
		const formData = new FormData();
		formData.append('captcha_id', this.currentCaptcha);
		formData.append('secret', this.getInvoiceSecret(this.currentCaptcha));
		formData.append('url', url);
		fetch(getThreadsURL, {
				method: 'POST',
				body: formData
			})
			.then(response => {
				if (response.ok) {
					return response.text();
				} else {
					throw new Error('Network response was not ok');
				}
			})
			.then(json => {
				const data = typeof json == 'string'? JSON.parse(json): json;
				if(!data || typeof data != 'object'){
					this.feed('Server response parse failed.', true);
					return;
				}
				if (data.error) {
					this.feed(`Error: ${data.error}`, true);
					return;
				}
				this.feed(data.msg);
				const threads = data.threads;
				const threadContainer = document.getElementById('thread_container');

				if(!threads || !Array.isArray(threads) || threads.length < 1){
					const message = document.createElement('div');
					message.textContent = 'Be the first to create a thread on this page!';
					const createThreadLink = document.createElement('a');
					createThreadLink.href = '#';
					createThreadLink.textContent = 'Create Thread';
					createThreadLink.addEventListener('click', (e) => {
						e.preventDefault();
						document.getElementById('create_thread_toggle_link').click();
					});
					threadContainer.innerHTML = '';
					threadContainer.appendChild(document.createElement('br'));
					threadContainer.appendChild(document.createElement('br'));
					threadContainer.appendChild(message);
					threadContainer.appendChild(document.createElement('br'));
					threadContainer.appendChild(createThreadLink);
					return;
				}

				threadContainer.innerHTML = '';
				threadContainer.classList.remove('thread');
				threads.forEach( thread => {
					const isMe = thread?.is_me || false;
					const isFree = thread?.is_free || false;

					const threadDiv = document.createElement('div');
					if(isFree) threadDiv.classList.add('free_thread');
					threadDiv.classList.add('thread');
					if(thread.invoice_id && this.state.my_invoice_ids.indexOf(thread.invoice_id*1) > -1){
						threadDiv.classList.add('my_thread');
					}
					var alias_str = '';
					if('alias' in thread && thread.alias && typeof thread.alias == 'string'){
						alias_str = `&nbsp;&nbsp;<strong style="color:#183f36;">${thread.alias}</strong>`;
					}
					const password_xml = thread.password_required? this.heroicon('lock-closed').outerHTML: '';
					const loadThreadLink = document.createElement('a');
					loadThreadLink.innerHTML = `<span style="font-size:9px;opacity:0.6;"><strong style="color:grey;">Thread ${thread.thread_id}</strong>${alias_str}<span class="pull-right">${password_xml}</span></span><br><strong>${thread.chat_content}</strong>`;
					loadThreadLink.setAttribute('data-thread-id', thread.thread_id);
					loadThreadLink.classList.add('thread_opener');
					if(thread.password_required) loadThreadLink.classList.add('password_required');
					loadThreadLink.addEventListener('click', (e) => {
						e.preventDefault();
						if(this.paused) return;
						// Get thread ID from the clicked element
						var ctarg = e.currentTarget;
						var threadId = ctarg.getAttribute('data-thread-id');
						if(ctarg.classList.contains('password_required')){
							const existingPassForm = document.querySelector('.thread_pass_form[data-thread-id="' + threadId + '"]');
							if(existingPassForm){ // user decides not to join thread
								// remove all existing pass forms
								const passForms = document.querySelectorAll('.thread_pass_form');
								passForms.forEach((passForm) => passForm.remove());
								return;
							}
							const passForm = document.createElement('form');
							passForm.setAttribute('data-thread-id',threadId);
							passForm.classList.add('thread_pass_form');
							const cachedPass = this.getCachedPass(threadId);
							const cachedPassStr = cachedPass? ` value="${cachedPass}"`: '';
							passForm.innerHTML = `
								<input type="password" name="password" placeholder="Password"${cachedPassStr}>
								<input type="submit" value="Login to Thread ${threadId}">
							`;
							passForm.addEventListener('submit', (e) => {
								e.preventDefault();
								const formData = new FormData(e.target);
								const password = this.cachePass(threadId, formData.get('password'));
								this.loadThread(threadId, password);
							});
							ctarg.parentElement.appendChild(passForm);
						}else{
							this.loadThread(threadId);
						}
					});
					threadDiv.appendChild(loadThreadLink);

					// Likes and dislikes
					var reactionContainer = this.reactDiv(thread.chat_id, thread.alias, thread.chat_date_submitted, isMe);
					threadDiv.appendChild(reactionContainer);

					// Comment Count
					if(thread.comment_count && !isNaN(thread.comment_count*1) && thread.comment_count > 0){
						const heightFixer = reactionContainer.getElementsByClassName('reaction_height_fixer').item(0);
						if (!heightFixer) return;
						const commentLink = document.createElement('a');
						commentLink.href = '#';
						commentLink.innerHTML = this.heroicon('chat-bubble-bottom-center-text').outerHTML + '&nbsp;' + thread.comment_count;
						commentLink.title = 'View comments';
						commentLink.addEventListener('click', (e) => {
							e.preventDefault();
							const threadDiv 	= e.currentTarget.closest('.thread');
							if (!threadDiv) return;
							const threadOpener 	= threadDiv.querySelector('.thread_opener');
							if (!threadOpener) return;
							threadOpener.click();
						});
						heightFixer.appendChild(commentLink);
					}

					threadContainer.appendChild(threadDiv);
				});
				this.updateReactions(data.reactions);
				// scroll to btm of thread_container
				document.getElementById('thread_container').scrollTop = document.getElementById('thread_container').scrollHeight;
				setTimeout(this.updateTCHeight,20);
			})
			.catch(error => {
				this.feed('There has been a problem with your fetch operation. See console.', true);
				console.trace(error);
			});
			setTimeout(this.updateTCHeight,20);
	}

	updateTCHeight(){
		var win_height			= document.documentElement.clientHeight*1;
			win_height			= window.innerHeight < win_height? window.innerHeight: win_height;
		const home				= document.getElementById('home');
		const home_top			= home.getBoundingClientRect().top*1;
		const home_style		= window.getComputedStyle(home);
		const home_margin		= parseFloat(home_style.marginTop) + parseFloat(home_style.marginBottom);
		const home_padding		= parseFloat(home_style.paddingTop) + parseFloat(home_style.paddingBottom);
		home.style.height		= (win_height - home_top - home_margin - home_padding - 10) + 'px';
		home.style.maxHeight 	= (win_height - home_top - home_margin - home_padding) + 'px';
	}

	// Update settings
	updateSettings(newSettings) {
		let validSettings = {};
		let invalidParams = [];
		for (let key in newSettings) {
			if (this.settingsSchema[key]){
				if(typeof newSettings[key] === this.settingsSchema[key]){
					validSettings[key] = newSettings[key];
				}else if(this.settingsSchema[key] === 'number' && !isNaN(newSettings[key]*1)){
					if (key in this.settingsLimits){
						const settingLimits = this.settingsLimits[key];
						if (!Array.isArray(settingLimits) || settingLimits.length !== 2) continue;
						validSettings[key] = newSettings[key] < settingLimits[0]? settingLimits[0]: newSettings[key];
						validSettings[key] = newSettings[key] > settingLimits[1]? settingLimits[1]: newSettings[key];
					}else{
						validSettings[key] = newSettings[key]*1;
					}
				}else if(this.settingsSchema[key] === 'boolean' && ["true","false"].indexOf(newSettings[key].toString().toLowerCase()) > -1){
					validSettings[key] = newSettings[key].toString().toLowerCase() === 'true'? true: false;
				}else{
					invalidParams.push(key);
				}
			}else{
				invalidParams.push(key);
			}
		}
	
		if(invalidParams.length > 0){
			const invStr = invalidParams.join(', ');
			this.feed(`Invalid setting or type for parameter(s): ${invStr}`,true);
		}else{
			this.state.settings = { ...this.state.settings, ...validSettings }; // merge partial settings with existing settings
			this.saveState();
			this.feed("Settings updated.")
		}

	}

	getSpentKeys() {
		return this.state.spent_keys;
	}
	
	getInvoices() {
		return this .state.invoices;
	}

	getSetting(key) {
		return this.state.settings?.[key] || this.settingsDefault[key] || null;
	}

	getCurrentURL() {
		return this.state.current_user_url;
	}
	
	getShortURL(){
		const url_len 	= this.getSetting('url_preview_max_len');
		const url 		= this.getCurrentURL();
		var shortUrl 	=  url.substr(0,url_len);
		return url.length > url_len? shortUrl + "...": url + "";
	}

	// GUI Output
	updateCurrentUserURL(url, save_state = true) {
		const last_current_url								= this.getCurrentURL();
		this.state.current_user_url 						= url.toString();
		document.getElementById('current_url').title 		= this.getCurrentURL();
		document.getElementById('current_url').innerHTML 	= this.getShortURL();
		this.saveState();
		if (last_current_url !== url.toString()){
			// Switch the user to threads mode and close the chat form
			const threadContainer = document.getElementById('thread_container');
			if(threadContainer && threadContainer.classList.contains('thread')){ // user in chat mode
				this.getThreads(url);
			}
		}
	}

	updateCurrentMetadata(metadata){
		this.state.current_metadata = (!metadata || typeof metadata != 'object')? {}: metadata;
		this.saveState();
	}
	
	feed(arg, err = false){
		if(this.skipFeed){ // used when autoloading threads or chats right after user action
			this.skipFeed = false;
			return;
		}
		const f 		= document.getElementById('feed');
		if(err){
			f.classList.add('error');
		}else{
			f.classList.remove('error');
		}
		if(!f) return;
		f.innerHTML 	= arg.toString() || "&nbsp;";
		const version 	= document.createElement('span');
		version.style.fontSize = '9px';
		version.style.opacity = '0.6';
		version.classList.add('pull-right');
		version.textContent = `v${this.version}`;
		f.appendChild(version);
	}

	updateConversionRates(){
		if(this.paused) return;
		
		const server_url = this.getSetting('server_url');
		if(!server_url || typeof server_url != 'string' || !server_url.startsWith('http')) return;
		const conversionRateURL = `${server_url}/static/btc_rate_current.json`

		// Get the refresh rate
		if(!conversionRateURL){
			this.feed('No conversion rate URL set.', true);
			return;
		}
		fetch(conversionRateURL)
			.then(response => {
				if (response.ok) {
					return response.text();
				} else {
					throw new Error('Network response was not ok');
				}
			})
			.then(json => {
				
				const data = typeof json == 'string'? JSON.parse(json): json;
				if(!data || !Array.isArray(data) || data.length < 1){
					this.feed('Array min length of 1 expected for conversion rates.', true);
					return;
				}
				this.conversionRates = data;

				// gui
				const conversionRateIndicator = document.getElementById('conversion_rate');
				if(conversionRateIndicator){
					const cryptoPrice = this.satoshiToFiatStr(this.cryptoToSatoshi(1));
					conversionRateIndicator.textContent = `1 ₿ = ${cryptoPrice}`;
				}
			})
			.catch(error => {
				console.error(error);
			});
	}

	satoshiToCrypto(satoshi){
		if(isNaN(satoshi*1) || satoshi < 1 || satoshi % 1 > 0) return 0;
		return satoshi / 100_000_000;
	}

	cryptoToSatoshi(crypto_amount){
		if(isNaN(crypto_amount*1)) return 0;
		return Math.floor(crypto_amount * 100_000_000);
	}

	fiatToSatoshi(fiat_amount, altFiatCode = null){
		if(isNaN(fiat_amount*1)) return 0;
		var fiat_code = this.getSetting('fiat_code');
		if(altFiatCode && typeof altFiatCode == 'string' && altFiatCode.length === 3){
			fiat_code = altFiatCode;
		}
		const rate = this.conversionRates.find(rate => rate.code === fiat_code);
		if(!rate || !rate.rate || isNaN(rate.rate*1)) return 0;
		return this.cryptoToSatoshi(fiat_amount / rate.rate);
	}

	satoshiToFiat(satoshi, altFiatCode = null){
		if(isNaN(satoshi*1) || satoshi % 1 > 0) return 0;
		var fiat_code = this.getSetting('fiat_code');
		if(altFiatCode && typeof altFiatCode == 'string' && altFiatCode.length === 3){
			fiat_code = altFiatCode;
		}
		const rate = this.conversionRates.find(rate => rate.code === fiat_code);
		if(!rate || !rate.rate || isNaN(rate.rate*1)) return 0;
		const fiat_amount = (satoshi / 100_000_000) * rate.rate;
		return fiat_amount;
	}

	fiatToCryptoStr(fiat_amount){
		return this.satoshiToCrypto(this.fiatToSatoshi(fiat_amount)) + " ₿";
	}

	fiatToSatoshiStr(fiat_amount){
		return this.fiatToSatoshi(fiat_amount) + " sats";
	}

	satoshiToCryptoStr(satoshi){
		return this.satoshiToCrypto(satoshi) + " ₿";
	}

	fiatCodeToSymbol(fiat_code){
		var curr_char 		= fiat_code + '';
		switch(fiat_code){
			case 'USD': curr_char = '$'; break;
			case 'EUR': curr_char = '€'; break;
			case 'GBP': curr_char = '£'; break;
			case 'JPY': curr_char = '¥'; break;
			case 'AUD': curr_char = 'A$'; break;
			case 'CAD': curr_char = 'C$'; break;
			case 'CHF': curr_char = 'Fr'; break;
			case 'CNY': curr_char = 'CN¥'; break;
			case 'SEK': curr_char = 'kr'; break;
			case 'NZD': curr_char = 'NZ$'; break;
			case 'KRW': curr_char = '₩'; break;
			case 'SGD': curr_char = 'S$'; break;
			case 'NOK': curr_char = 'kr'; break;
			case 'MXN': curr_char = 'Mex$'; break;
			case 'HKD': curr_char = 'HK$'; break;
			case 'TRY': curr_char = '₺'; break;
			case 'RUB': curr_char = '₽'; break;
			case 'INR': curr_char = '₹'; break;
			case 'BRL': curr_char = 'R$'; break;
			case 'ZAR': curr_char = 'R'; break;
			case 'IDR': curr_char = 'Rp'; break;
			case 'MYR': curr_char = 'RM'; break;
			case 'PHP': curr_char = '₱'; break;
			case 'THB': curr_char = '฿'; break;
			case 'VND': curr_char = '₫'; break;
			case 'PLN': curr_char = 'zł'; break;
			case 'TWD': curr_char = 'NT$'; break;
			case 'SAR': curr_char = 'ر.س'; break;
			case 'AED': curr_char = 'د.إ'; break;
			case 'CZK': curr_char = 'Kč'; break;
			case 'CLP': curr_char = 'CLP$'; break;
			case 'ILS': curr_char = '₪'; break;
			case 'KES': curr_char = 'KSh'; break;
			case 'PKR': curr_char = '₨'; break;
			case 'QAR': curr_char = 'QR'; break;
			case 'HUF': curr_char = 'Ft'; break;
			case 'EGP': curr_char = 'E£'; break;
			case 'COP': curr_char = 'COL$'; break;
			case 'ARS': curr_char = 'AR$'; break;
			case 'DOP': curr_char = 'RD$'; break;
			case 'CRC': curr_char = '₡'; break;
			case 'PEN': curr_char = 'S/.'; break;
			case 'UYU': curr_char = '$U'; break;
			case 'BOB': curr_char = 'Bs'; break;
			case 'PYG': curr_char = '₲'; break;
			case 'DKK': curr_char = 'kr'; break;
			case 'ISK': curr_char = 'ikr'; break;
			case 'RON': curr_char = 'lei'; break;
			case 'BGN': curr_char = 'лв'; break;
			case 'MAD': curr_char = 'د.م.'; break;
			case 'ZMW': curr_char = 'ZK'; break;
			case 'BHD': curr_char = '.د.ب'; break;
			case 'OMR': curr_char = 'ر.ع.'; break;
			case 'JOD': curr_char = 'د.ا'; break;
			case 'TND': curr_char = 'د.ت'; break;
			case 'LBP': curr_char = 'ل.ل'; break;
			case 'GHS': curr_char = '₵'; break;
			case 'NGN': curr_char = '₦'; break;
			case 'ETB': curr_char = 'Br'; break;
			case 'TZS': curr_char = 'TSh'; break;
			case 'MUR': curr_char = '₨'; break;
			case 'UGX': curr_char = 'USh'; break;
			case 'DZD': curr_char = 'د.ج'; break;
			case 'VUV': curr_char = 'VT'; break;
			case 'FJD': curr_char = 'FJ$'; break;
			case 'PGK': curr_char = 'K'; break;
			case 'XOF': curr_char = 'CFA'; break;
			case 'XAF': curr_char = 'CFA'; break;
			case 'KZT': curr_char = '₸'; break;
			case 'GEL': curr_char = '₾'; break;
			default:;
		}
		return curr_char;
	}

	satoshiToFiatStr(satoshi){
		const fiat_code = this.getSetting('fiat_code');
		if (!fiat_code) return "---";
		const curr_char		= this.fiatCodeToSymbol(fiat_code);
		var curr_accuracy 	= 2; // TODO: Add special cases for certain fiat codes
		return curr_char + this.satoshiToFiat(satoshi).toLocaleString(undefined, { minimumFractionDigits: curr_accuracy, maximumFractionDigits: curr_accuracy });
	}
	
	rebuildSettingsForm() {
        const form = document.getElementById('settings_form');
		if(!form) return;
        form.innerHTML = ''; // Clear the form

		// Get alpha sorted keys from this.state.settings
		const sortedKeys = Object.keys(this.settingsDefault).sort();

        for (var i=0; i<sortedKeys.length; i++) {
			const key  	= sortedKeys[i];
            const label = document.createElement('label');
            label.textContent = key.replace(/_/g, ' ').toUpperCase();
            form.appendChild(label);

            let input;
            if (typeof this.settingsDefault[key] === 'boolean') {
                input = document.createElement('select');
                ['true', 'false'].forEach(optionValue => {
                    const option = document.createElement('option');
                    option.value = optionValue;
                    option.text = optionValue.charAt(0).toUpperCase() + optionValue.slice(1);
                    if (String(this.state.settings?.[key]) === optionValue) {
                        option.selected = true;
                    }
                    input.appendChild(option);
                });
            } else {
                input = document.createElement('input');
                input.type = typeof this.settingsDefault[key] === 'number' ? 'number' : 'text';
				if(input.type == 'number' && key in this.settingsLimits){
					const limits = this.settingsLimits[key];
					input.min = limits[0];
					input.max = limits[1];
				}
                input.value = this.state.settings?.[key] || this.settingsDefault[key];
            }
            input.name = key;
            form.appendChild(input);

			if(key == 'server_url'){
				// Get all server_urls from invoices in this.state.invoices
				var server_urls = [];
				for (let name in this.state.invoices) {
					if(this.state.invoices[name].server_url && typeof this.state.invoices[name].server_url == 'string'){
						server_urls.push(this.state.invoices[name].server_url);
					}
				}
				// Make server_urls unique and alpha sorted
				server_urls = [...new Set(server_urls)].sort();
				// Add a button to set the input value to each of the available server_urls
				server_urls.forEach(server_url => {
					const urlset = document.createElement('a');
					urlset.textContent = `Set to ${server_url}`;
					urlset.addEventListener('click', () => {
						input.value = server_url;
					});
					form.appendChild(urlset);
					form.appendChild(document.createElement('br'));
				});
				form.appendChild(document.createElement('br'));
				form.appendChild(document.createElement('br'));
			}else if(key == 'fiat_code'){
				// Get all fiat_codes from conversion rates
				const fiat_codes = this.conversionRates.map(rate => rate.code).sort();
				// Add a button to set the input value to each of the available fiat_codes
				fiat_codes.forEach(fiat_code => {
					const fiatCodeSet = document.createElement('a');
					fiatCodeSet.textContent = fiat_code;
					fiatCodeSet.style.paddingRight = '5px';
					fiatCodeSet.style.paddingLeft = '5px';
					fiatCodeSet.style.cursor = 'pointer';
					fiatCodeSet.addEventListener('click', () => {
						input.value = fiat_code;
					});
					form.appendChild(fiatCodeSet);
				});
				form.appendChild(document.createElement('br'));
				form.appendChild(document.createElement('br'));
			}
        }

        // Add the submit button
        const submitButton = document.createElement('button');
        submitButton.type = 'submit';
		submitButton.classList.add('submit_settings_button');
        submitButton.textContent = 'Save Settings';
        form.appendChild(submitButton);
    }
	
	rebuildInvoiceList(){
		const container = document.getElementById('invoice_container');
		if(!container) return;
        container.innerHTML = '';
		var total_invoices = 0, server_invoices = 0;
		const date_sorted_invoice_keys = Object.keys(this.state.invoices).sort((a, b) => {
			const dateA = new Date(this.state.invoices[a].created);
			const dateB = new Date(this.state.invoices[b].created);
			return dateB - dateA;
		});
		for (var i=0; i<date_sorted_invoice_keys.length; i++){
			var name = date_sorted_invoice_keys[i];

			total_invoices++;

			// We only want invoices for the current server
			if (this.state.invoices[name].server_url !== this.getSetting('server_url')) {
				continue;
			}

			server_invoices++;

			const invoice = JSON.parse(JSON.stringify(this.state.invoices[name]));
			// Create a div for each invoice
			const invoiceDiv = document.createElement('div');
			invoiceDiv.setAttribute("data-captcha-id",name);
			invoiceDiv.setAttribute("data-date-created",invoice.created);
			invoiceDiv.setAttribute("data-balance",invoice.balance);
			invoiceDiv.classList.add('invoice');

			// Create checkboxes for each invoice
			const checkbox = document.createElement('input');
			checkbox.type = 'checkbox';
			checkbox.classList.add('invoice_checkbox');


			// Create and append invoice details
			const nameElement = document.createElement('strong');
			nameElement.textContent = name.substring(0, 8) + '...';
			const alias = invoice?.alias || null;
			if(alias && typeof alias == 'string') nameElement.textContent = alias;
			invoiceDiv.appendChild(nameElement);
			invoiceDiv.appendChild(document.createElement('br'));

			const urlElement = document.createElement('a');
			urlElement.textContent = `${invoice.server_url.replace('https://','').replace('http://','')}`;
			urlElement.href = invoice.server_url;
			urlElement.style.fontSize = '9px';
			urlElement.target = '_blank';
			invoiceDiv.appendChild(urlElement);

			if(invoice.val && invoice.curr){
				const faceValueElement = document.createElement('p');
				faceValueElement.textContent = `Purchase Price: ${invoice.val} ${invoice.curr}`;
				invoiceDiv.appendChild(faceValueElement);
			}

			const btcPaidElement = document.createElement('p');
			btcPaidElement.textContent = `BTC Paid: ${invoice.btc_paid}`;
			invoiceDiv.appendChild(btcPaidElement);

			const rateQuoteElement = document.createElement('p');
			rateQuoteElement.textContent = `Rate Quote: ${invoice.rate_quote} Satoshis per API call.`;
			invoiceDiv.appendChild(rateQuoteElement);

			const balanceElement = document.createElement('p');
			const fiatStr = this.satoshiToFiatStr(invoice.balance);
			balanceElement.textContent = `Balance: ${invoice.balance} sats (${fiatStr})`;
			invoiceDiv.appendChild(balanceElement);


			const createdElement = document.createElement('p');
			createdElement.textContent = `Created: ${invoice.created}`;
			invoiceDiv.appendChild(createdElement);

			const repoElement = document.createElement('a');
			repoElement.textContent = `ERROR: No Recovery Phrase!`;
			repoElement.href = '#';
			if(invoice.repo){
				repoElement.textContent = `Copy Recovery Phrase`;
				repoElement.title = "Copy Recovery Phrase to clipboard";
				repoElement.addEventListener('click', (e) => {
					e.preventDefault();
					navigator.clipboard.writeText(invoice.repo);
					this.feed('Recovery Phrase copied to clipboard.');
					e.target.style.opacity = 0;
					setTimeout(() => e.target.style.opacity = 1, 700); 
				});
			}
			const repoIcon = this.heroicon('clipboard-document');
			repoIcon.style.marginRight = '5px';
			repoElement.prepend(repoIcon);


			const invoiceLink = document.createElement('a');
			invoiceLink.textContent = `ERROR: No invoice link!`;
			invoiceLink.href = "#";
			if(invoice.link){
				invoiceLink.textContent = `Open Invoice`;
				invoiceLink.href = invoice.link;
				invoiceLink.target = '_blank';
			}
			const invoiceLinkIcon = this.heroicon('document-currency-dollar');
			invoiceLinkIcon.style.marginRight = '5px';
			invoiceLink.prepend(invoiceLinkIcon);

			const redeemLink = document.createElement('a');
			redeemLink.textContent = `Update Balance`;
			redeemLink.title = "Redeem/Refresh this invoice";
			redeemLink.href = '#';
			redeemLink.classList.add('invoice_redeem_link');
			redeemLink.setAttribute("data-captcha-id",name);
			redeemLink.setAttribute("data-captcha-id",name);
			const redeemIcon = this.heroicon('arrow-path');
			redeemIcon.style.marginRight = '5px';
			redeemLink.prepend(redeemIcon);
			redeemLink.addEventListener('click', (e) => {
				// empty the invoice container and add wait message
				const click_target_parent = e.target.parentElement;
				// lock height of parent
				click_target_parent.style.height = click_target_parent.offsetHeight + "px";

				click_target_parent.innerHTML = 'Please wait...';

				// Get the captcha ID from the clicked element
				const captchaId = e.target.getAttribute('data-captcha-id');
				this.redeemInvoice(captchaId);
			});

			// Request payout link
			const payoutLink = document.createElement('a');
			payoutLink.textContent = `Request Payout`;
			payoutLink.title = "Request a payout for this invoice";
			payoutLink.href = '#';
			payoutLink.classList.add('invoice_payout_link');
			payoutLink.setAttribute("data-captcha-id",name);
			const payoutIcon = document.createElement('span');
			payoutIcon.textContent = '₿';
			payoutIcon.style.marginRight = '5px';
			payoutLink.prepend(payoutIcon);
			payoutLink.addEventListener('click', (e) => {
				e.preventDefault();
				// Get the captcha ID from the clicked element
				const captchaId 	= e.currentTarget.getAttribute('data-captcha-id');
				const secret 		= this.state.invoices[captchaId].secret
				const sentToAddress = prompt('Enter the BTC address to send the funds to:');
				if (!sentToAddress){
					this.feed("Action Cancelled.");
					return;
				};
				if(typeof sentToAddress !== 'string' || sentToAddress.trim().length < 26){
					this.feed("BTC receiving address must be at least 26 characters.");
					return;
				}
				const server_url = this.getSetting('server_url');
				if(!server_url || typeof server_url != 'string' || !server_url.startsWith('http')){
					this.feed('No server URL set.', true);
					return;
				}
				const payoutEndpoint = `${server_url}/get_funds`;
				const formData = new FormData();
				formData.append('captcha_id', captchaId);
				formData.append('secret', secret);
				formData.append('send_to_address', sentToAddress.trim());
				// Send the POST request to redeem the invoice
				fetch(payoutEndpoint, {
					method: 'POST',
					body: formData
				})
				.then(response => {
					
					if (response.ok) {
						return response.text();
					} else {
						throw new Error('Network response was not ok');
					}
				})
				.then(json => {
					
					const data = typeof json == 'string'? JSON.parse(json): json;
					if(!data || typeof data != 'object'){
						this.feed('Server response parse failed.', true);
						return;
					}
					if(data.error){
						this.feed(`Error: ${data.error.toString()}`, true);
						return;
					}
					if(data.msg) this.feed(data.msg);
					const req = data.payout_request;
					if(
						!req || typeof req != 'object' || 
						!("satoshi_withdrawal" in req) || !req.satoshi_withdrawal || isNaN(req.satoshi_withdrawal*1) ||
						!("send_to_address" in req) || !req.send_to_address || typeof req.send_to_address != 'string' || req.send_to_address.length < 26 || 
						!("btcpay_id" in req) || !req.btcpay_id || typeof req.btcpay_id != 'string' || req.btcpay_id.length < 3
					){
						this.feed('There was a problem with the payout request.', true);
						return;
					}
					req.satoshi_withdrawal = req.satoshi_withdrawal*1;
					this.state.invoices[captchaId].payout_requests = data.payout_requests || [];
					this.state.invoices[captchaId].payout_requests.push(req);
					this.rebuildInvoiceList();
				})
				.catch(error => {
					this.feed('There has been a problem with your fetch operation. See console.', true);
					console.error(error);
				});
			});

			const verifyLink = document.createElement('a');
			verifyLink.textContent = `Get Verified Username or Nickname`;
			verifyLink.title = "Get a verified username for this virtual wallet.";
			verifyLink.href = '#';
			verifyLink.classList.add('invoice_verify_link');
			verifyLink.setAttribute("data-captcha-id",name);
			const verifyIcon = this.heroicon('check-badge');
			verifyIcon.style.marginRight = '5px';
			verifyLink.prepend(verifyIcon);
			verifyLink.addEventListener('click', (e) => {
				e.preventDefault();
				const captchaId = e.currentTarget.getAttribute('data-captcha-id');
				document.querySelectorAll('.invoice_verification_form').forEach((form) => form.remove());
				document.querySelectorAll('.invoice_verification_cancel_link').forEach((link) => link.remove());
				const cancelVerificationLink = document.createElement('a');
				cancelVerificationLink.innerHTML = '<strong style="font-style:normal;">X</strong>&nbsp;&nbsp;<span style="font-style:italic;">Cancel</span>';
				cancelVerificationLink.href = '#';
				cancelVerificationLink.style.filter = 'grayscale(1)';
				cancelVerificationLink.style.opacity = '0.5';
				cancelVerificationLink.style.display = 'inline-block';
				cancelVerificationLink.style.marginLeft = '15px';
				cancelVerificationLink.style.marginBottom = '15px';
				cancelVerificationLink.classList.add('invoice_verification_cancel_link');
				cancelVerificationLink.addEventListener('click', (e) => {
					e.preventDefault();
					document.querySelectorAll('.invoice_verification_form').forEach((form) => form.remove());
					document.querySelectorAll('.invoice_verification_cancel_link').forEach((link) => link.remove());
				});
				const verificationForm = document.createElement('form');
				verificationForm.classList.add('invoice_verification_form');
				verificationForm.setAttribute("data-captcha-id",captchaId);
				verificationForm.innerHTML = `
					<br>
					<strong style="font-size:20px;">Get a Username!</strong>
					<br><br>
					Update old chats and threads?
					<br>
					<select name="update_old_chats">
						<option value="Yes" selected>Yes, update old chats and threads</option>
						<option value="No">No, just apply to new chats and threads.</option>
					</select>
					<br><br>
					Previous Verified Usernames
					<br>
					<select name="previous_verified_usernames" data-captcha-id="${name}"><option value="0">Loading...</option></select>
					<br><br>
					<input type="text" name="username_submission" data-captcha-id="${name}" placeholder="New Username..." style="font-size:20px;">
					<br><br>
					Get Verified or get free nickname?
					<br>
					<select name="verification_type">
						<option value="verified" selected>Verified Username (pay fee)</option>
						<option value="nickname">Free Nickname (no fee)</option>
					</select>
					<br>
					<strong>Fee:</strong> <span class="user_verification_fee">Loading...</span>
					<br><br>
					<input type="submit" value="Get New Username">
					<br><br>
					NOTE: This account will no longer be anonymous after adding a nickname or verified username. You will need to create/use a different account to post anonymously again.
				`;

				verificationForm.addEventListener('submit', (e) => {
					e.preventDefault();
					const formData = new FormData(e.currentTarget);
					const captchaId = e.currentTarget.getAttribute('data-captcha-id');
					const secret = this.state.invoices[captchaId].secret;
					formData.append('captcha_id', captchaId);
					formData.append('secret', secret);
					const server_url = this.getSetting('server_url');
					if(!server_url || typeof server_url != 'string' || !server_url.startsWith('http')){
						this.feed('No server URL set.', true);
						return;
					}
					const verificationEndpoint 	= `${server_url}/verified_name`;
					const nickNameEndpoint 		= `${server_url}/preferred_name`;
					const verificationType 		= formData.get('verification_type');
					const useEndpoint			= verificationType == 'verified'? verificationEndpoint: nickNameEndpoint;
					const submitButton 			= e.currentTarget.querySelector('input[type="submit"]');
					submitButton.disabled = true;
					submitButton.value = 'Please wait...';
					// send it
					this.transactionCaptcha = captchaId;
					fetch(useEndpoint, {
						method: 'POST',
						body: formData
					})
					.then(response => {
						if (response.ok) {
							return response.text();
						} else {
							throw new Error('Network response was not ok');
						}
					})
					.then(json => {
						const data = typeof json == 'string'? JSON.parse(json): json;
						if(!data || typeof data != 'object'){
							this.feed('Server response parse failed.', true);
							return;
						}
						if(data.error){
							this.feed(`Error: ${data.error.toString()}`, true);
						}else if(data.msg){
							this.feed(data.msg);
							const new_username = data?.new_username || null;
							if(new_username){
								const invoice = this.state.invoices?.[this.transactionCaptcha] || null;
								if(invoice){
									invoice.alias = new_username;
									this.skipFeed = true;
									this.redeemInvoice(this.transactionCaptcha);
								}else{
									this.feed('No invoice found for this captcha ID.', true);
								}
							}else{
								this.feed('No id/username pair found in server response.', true);
							}
						}
						document.querySelectorAll('.invoice_verification_form').forEach((form) => form.remove());
						document.querySelectorAll('.invoice_verification_cancel_link').forEach((link) => link.remove());
					})
				});


				// Get previous verified usernames and the the verification fee
				const server_url = this.getSetting('server_url');
				if(!server_url || typeof server_url != 'string' || !server_url.startsWith('http')){
					this.feed('No server URL set.', true);
					return;
				}
				const previousVerifiedNamesEndpoint = `${server_url}/verified_names_previous`;
				const formData = new FormData();
				formData.append('captcha_id', captchaId);
				formData.append('secret', this.getInvoiceSecret(captchaId));
				fetch(previousVerifiedNamesEndpoint, {
					method: 'POST',
					body: formData
				})
				.then(response => {
					if (response.ok) {
						return response.text();
					} else {
						throw new Error('Network response was not ok');
					}
				})
				.then(json => {
					const data = typeof json == 'string'? JSON.parse(json): json;
					if(!data || typeof data != 'object'){
						this.feed('Server response parse failed.', true);
						return;
					}
					const captcha_id = data?.captcha_id || null;
					const verified_names = data?.verified_names || [];
					if(captcha_id){
						const select = verificationForm.querySelector(`select[name="previous_verified_usernames"][data-captcha-id="${captcha_id}"]`);
						if(select){
							if(verified_names.length > 0){
								select.innerHTML = '';
								verified_names.forEach((name) => {
									const option = document.createElement('option');
									option.value = name;
									option.textContent = name;
									select.appendChild(option);
								});
							}else{
								select.innerHTML = '<option value="0">None</option>';
							}
							select.addEventListener('change', (e) => {
								const captchaId = e.target.getAttribute('data-captcha-id');
								const input = document.querySelector(`input[name="username_submission"][data-captcha-id="${captchaId}"]`);
								input.value = e.target.value.replace(/\$/g,'').replace(/_/g,' ');
							});
						}
					}

					// Get the verification fee
					const server_url = this.getSetting('server_url');
					if(!server_url || typeof server_url != 'string' || !server_url.startsWith('http')){
						this.feed('No server URL set.', true);
						return;
					}
					const verificationFeeEndpoint = `${server_url}/static/current_fees.json`;
					fetch(verificationFeeEndpoint)
					.then(response => {
						if (response.ok) {
							return response.text();
						} else {
							throw new Error('Network response was not ok');
						}
					})
					.then(json => {
						const data = typeof json == 'string'? JSON.parse(json): json;
						var vfee = data?.verified_name || {};
							vfee = (vfee && typeof vfee == 'object')? vfee: {};
						const fee 	= vfee.fee || null;
						const unit 	= vfee.unit || null;
						var feeStr 	= 'ERROR: Fee not found!';
						if(fee && unit){
							const stats = this.fiatToSatoshi(fee, unit);
							const fiatStr = this.satoshiToFiatStr(stats, unit);
							feeStr = `${fiatStr} (${stats} sats)`;
						}
						document.querySelectorAll('.user_verification_fee').forEach((el) => el.textContent = feeStr);
					});
				});
				e.currentTarget.after(cancelVerificationLink);
				e.currentTarget.after(verificationForm);
			});

			invoiceDiv.appendChild(document.createElement('br'));
			invoiceDiv.appendChild(verifyLink);
			invoiceDiv.appendChild(document.createElement('br'));
			invoiceDiv.appendChild(repoElement);
			invoiceDiv.appendChild(document.createElement('br'));
			invoiceDiv.appendChild(invoiceLink);
			invoiceDiv.appendChild(document.createElement('br'));
			invoiceDiv.appendChild(redeemLink);
			invoiceDiv.appendChild(document.createElement('br'));
			invoiceDiv.appendChild(payoutLink);

			// Append the invoice div to the container
			container.appendChild(invoiceDiv);
			this.updateFollowList(name);
			setTimeout(load_invoice_selectors, 10);
		}

		// Tell users how many invoices they have
		document.getElementById('invoice_count_indicator').innerHTML = `Total Wallets: ${total_invoices}<br>Server Wallets: ${server_invoices}`;
		
		// Sort by date created with newest at top.
		const elements = Array.from(container.children);
		elements.sort((a, b) => {
			const dateA = new Date(a.getAttribute('data-date-created'));
			const dateB = new Date(b.getAttribute('data-date-created'));
			return dateA - dateB;
		});
		elements.forEach(element => container.appendChild(element));
	}

	redeemInvoice(captchaId){
		if(this.paused) return;
		console.trace('redeemInvoice() traced for bug hunting.');
		app.transactionCaptcha = null; // this should be set to null after the transaction is complete and the balance is updated with this method.
		const server_url = this.getSetting('server_url');
		if(!server_url || typeof server_url != 'string' || !server_url.startsWith('http')){
			this.feed('No server URL set.', true);
			return;
		}
		const redeemEndpoint = `${server_url}/redeem_invoice`;
		const formData = new FormData();
		formData.append('captcha_id', captchaId);
		formData.append('secret', this.state.invoices[captchaId].secret);

		// Send the POST request to redeem the invoice
		fetch(redeemEndpoint, {
			method: 'POST',
			body: formData
		})
		.then(response => {
			
			if (response.ok) {
				return response.text();
			} else {
				throw new Error('Network response was not ok');
			}
		})
		.then(json => {
			
			const data = typeof json == 'string'? JSON.parse(json): json;
			if(!data || typeof data != 'object'){
				this.feed('Server response parse failed.', true);
				return;
			}
			if(data.error){
				this.feed(`Error: ${data.error.toString()}`, true);
			}if(data.msg){
				this.feed(data.msg);
				this.state.invoices[captchaId].alias 			= data.alias 			|| null;
				this.state.invoices[captchaId].rows_remaining 	= data.rows_remaining 	|| 0;
				this.state.invoices[captchaId].satoshi_paid 	= data.satoshi_paid 	|| 0;
				this.state.invoices[captchaId].btc_paid 		= data.btc_paid			|| 0;
				this.state.invoices[captchaId].balance 			= data.balance			|| 0;
				this.state.invoices[captchaId].rate_quote 		= data.rate_quote		|| 0;
				this.state.invoices[captchaId].link 			= data.link				|| null;
				this.state.invoices[captchaId].exchange_rate 	= data.exchange_rate	|| "...";
				this.state.invoices[captchaId].currency_pair 	= data.currency_pair	|| "...";
				this.state.invoices[captchaId].server_url		= this.state.settings.server_url.toString();
				if (!isNaN(data.exchange_rate*1)) {
					this.state.invoices[captchaId].conv_balance = data.exchange_rate * (data.balance / 100000000);
				}
				this.saveState();
				this.rebuildInvoiceList();
			}
		})
		.catch(error => {
			this.feed('There has been a problem with your fetch operation. See console.', true);
			console.error(error);
		});
	}

	heroicon(name) {
		const svgContainer = document.getElementById('heroicon-' + name);
		if (svgContainer) {
			const svg = svgContainer.querySelector('svg');
			if (svg) return svg.cloneNode(true);
		}
		return false;
	}

	scrolldown() {
		this.newMessages = 0;
		this.skipAutoScroll = false;
		document.getElementById('scroll_to_bottom_container').classList.add('faded');
		document.getElementById('new_msg_indicator').textContent = 'Latest';
		setTimeout(() => {
			document.getElementById('thread_container').scrollTop = document.getElementById('thread_container').scrollHeight;
			this.updateTCHeight();
		}, 10);
	}
}

/* Initialize app state */
const app = new AppState();

/* Extension functionality */
chrome.runtime.onMessage.addListener((message) => {
	if (message.cunurl){
		app.updateCurrentUserURL(message.cunurl);
	}
	if (message.cunmetadata) app.updateCurrentMetadata(message.cunmetadata);
});

/* Named functions */

function decodeHTMLEntities(text) {
    let element = document.createElement('div');
    element.innerHTML = text;
    return element.textContent;
}

function show_tab(tabId) {
	const tabs = document.querySelectorAll('.tab');
	const tabContents = document.querySelectorAll('.tab-content');

	tabs.forEach(tab => {
		if (tab.id === `tab-${tabId}`) {
			tab.classList.add('active');
			tab.classList.remove('inactive');
		} else {
			tab.classList.remove('active');
			tab.classList.add('inactive');
		}
	});

	tabContents.forEach(content => {
		if (content.id === tabId) {
			content.classList.add('active');
			content.classList.remove('inactive');
		} else {
			content.classList.remove('active');
			content.classList.add('inactive');
		}
	});

	switch(tabId) {
		case 'home':
			app.getThreads();
			load_invoice_selectors();
			break;
		case 'buy':
			app.rebuildInvoiceList();
			break;
		case 'settings':
			app.rebuildSettingsForm();
			break;
		default:;
	}
	app.rebuildInvoiceList();
}

function load_invoice_selectors(){
	const invoices 			= app.getInvoices();
	const invoiceSelectors 	= document.getElementsByClassName('invoice_selector');
	for (let i = 0; i < invoiceSelectors.length; i++) {
		const invoiceSelector = invoiceSelectors[i];
		const previouslySelected = invoiceSelector.value;
		const currentCaptcha = app.currentCaptcha;
		invoiceSelector.innerHTML = '';
		// sort invoices by balance in decending order
		const sortedInvoices = Object.keys(invoices).sort((a, b) => invoices[b].balance - invoices[a].balance );
		for (var j=0; j<sortedInvoices.length; j++){
			var captchaId = sortedInvoices[j];
			var invoice = invoices[captchaId];
			var balance = (invoice.balance && !isNaN(invoice.balance))? invoice.balance: 0;
			if(balance <= 0) continue;
			if(invoice.server_url !== app.getSetting('server_url')) continue; // skip invoices for other servers
			var cur_bal 	= app.satoshiToFiatStr(balance);
			const option 	= document.createElement('option');
			if(currentCaptcha && currentCaptcha === captchaId){
				option.selected = true;
			}else if(previouslySelected && previouslySelected === captchaId){
				option.selected = true;
			}
			option.value 	= captchaId;
			var captchaName = captchaId.substring(0, 8) + '...';
			if(invoice.alias) captchaName = invoice.alias.toString();
			option.textContent = `${String(balance).padStart(8,"0")}  |  ${cur_bal}  |  ${captchaName}...`;
			invoiceSelector.appendChild(option);
		}
		const freeChatOption = document.createElement('option');
		freeChatOption.value = 'free';
		freeChatOption.textContent = 'Free Chat Mode (not eligible for payouts)';
		invoiceSelector.appendChild(freeChatOption);
	}
}
/* Listeners (add after doc ready) */
document.addEventListener('DOMContentLoaded', () => {
	document.getElementById('tab-home').addEventListener('click', 		() => show_tab('home'));
	document.getElementById('tab-buy').addEventListener('click', 		() => show_tab('buy'));
	document.getElementById('tab-settings').addEventListener('click', 	() => show_tab('settings'));
	document.getElementById('tab-follows').addEventListener('click', 	() => {
		app.rebuildFollowList();
		show_tab('follows');
	});
	document.getElementById('buy_form').addEventListener('submit', 		(event) => {
		event.preventDefault();
		app.buyKeys(document.getElementById('buy_val').value, document.getElementById('buy_curr').value);
	});
	document.getElementById('settings_form').addEventListener('submit', (event) => {
		event.preventDefault();
		const form = event.target;
		const formData = new FormData(form);
		const formObject = {};
		formData.forEach((value, key) => {
			formObject[key] = value;
		});
		app.updateSettings(formObject);
		form.querySelector('.submit_settings_button').textContent = 'Extension Settings Saved!';
		setTimeout(() => form.querySelector('.submit_settings_button').textContent = 'Save Settings', 2000);
	});
	document.getElementById('create_thread_form').addEventListener('submit', (event) => {
		event.preventDefault();
		const form = event.target;
		const formData = new FormData(form);
		const formObject = {};
		formData.forEach((value, key) => {
			formObject[key] = value;
		});
		app.createThread(formObject.captcha_id,formObject.content,formObject.password,formObject.css, formObject.channel);
	});
	
	// invoice recovery
	document.getElementById('recover_invoice_toggle').addEventListener('click', () => {
		const recovery_form = document.getElementById('recover_invoice_form');
		if(recovery_form.style.display === 'none'){
			recovery_form.style.display = 'block';
		}else{
			recovery_form.style.display = 'none';
		}
	});
	document.getElementById('recover_invoice_form').addEventListener('submit', (event) => {
		event.preventDefault();
		const form = event.target;
		app.recoverInvoice(form);
		form.style.display = 'none';
	});
	const recoverIcon = app.heroicon('arrow-path');
	const recoverToggle = document.getElementById('recover_invoice_toggle');
	recoverIcon.style.paddingLeft = '5px';
	recoverToggle.appendChild(recoverIcon);
	
	// Invoice rollup
	document.getElementById('rollup_invoice_toggle').addEventListener('click', () => {
		const rollup_form = document.getElementById('rollup_invoice_form');
		if(rollup_form.style.display === 'none'){
			rollup_form.style.display = 'block';
		}else{
			rollup_form.style.display = 'none';
		}
	});
	document.getElementById('rollup_invoice_form').addEventListener('submit', (event) => {
		event.preventDefault();
		const form = event.target;
		app.rollupInvoices(form);
		form.style.display = 'none';
	});
	const rollupIcon = app.heroicon('arrow-uturn-up');
	const rollupToggle = document.getElementById('rollup_invoice_toggle');
	rollupIcon.style.paddingLeft = '5px';
	rollupToggle.appendChild(rollupIcon);
	document.getElementById('back_to_threads_bracket').addEventListener('click', () => {
		app.getThreads();
	});
	document.getElementById('thread_container').addEventListener('scroll', () => {
		const threadContainer = document.getElementById('thread_container');
		// isScrolledToBottom should check if the user is scrolled within 10px of the bottom
		const isScrolledToBottom = threadContainer.scrollHeight - threadContainer.clientHeight <= threadContainer.scrollTop + 10;
		if(isScrolledToBottom){
			app.newMessages = 0;
			app.skipAutoScroll = false;
			document.getElementById('scroll_to_bottom_container').classList.add('faded');
			document.getElementById('new_msg_indicator').textContent = 'Latest';
		}else{
			app.skipAutoScroll = true;
			document.getElementById('scroll_to_bottom_container').classList.remove('faded');
		}
	});
	document.getElementById('scroll_to_bottom_link').addEventListener('click', event => {
		event.preventDefault();
		app.scrolldown();
	});
	document.addEventListener('keydown', (event) => {
		const eventTarget = event.target;
		if(!eventTarget || !eventTarget.classList.contains('chat_input')) return;
		const chatId = eventTarget.getAttribute('data-chat-id');
		if(!chatId) return;
		var sendMoneyLink = document.querySelectorAll(`.send_money_btn[data-chat-id="${chatId}"]`);
		if(!sendMoneyLink || sendMoneyLink.length < 1) return;
		sendMoneyLink = sendMoneyLink[0];
		if(event.key === 'Enter' && event.ctrlKey){
			event.preventDefault();
			sendMoneyLink.click();
		}
	});
	document.getElementById('cancel_cross_post').addEventListener('click', (event) => {
		event.preventDefault();
		document.getElementById('cross_post_container').style.display = 'none';
		document.getElementById('cross_post_clone_container').innerHTML = '';
	});
	document.getElementById('pause').addEventListener('click', (event) => {
		event.preventDefault();
		app.pause();
	});
	const darkModeLink = document.getElementById('dark_mode_toggle');
	// load it with an icon on startup.
	const darkModeIcon = app.heroicon('moon');
	darkModeIcon.style.paddingLeft = '5px';
	darkModeLink.appendChild(darkModeIcon);
	const extCSSLink = document.getElementById('extension_css_link');
	darkModeLink.addEventListener('click', (event) => {
		event.preventDefault();
		app.darkMode = !app.darkMode;
		if(app.darkMode){
			const darkModeIcon = app.heroicon('sun');
			darkModeLink.innerHTML = '';
			darkModeLink.appendChild(darkModeIcon);
			extCSSLink.setAttribute('href', 'monitor_dark.css');
		}else{
			const darkModeIcon = app.heroicon('moon');
			darkModeLink.innerHTML = '';
			darkModeLink.appendChild(darkModeIcon);
			extCSSLink.setAttribute('href', 'monitor.css');
		}
	});
	function loadChannelSelector(){ // loads channel selector based on the selected account.
		console.log('loadChannelSelector()');
		const invoiceSelector = document.getElementById('create_thread_invoice_selector');
		if(!invoiceSelector) return;
		console.log('loadChannelSelector() - invoiceSelector found.');
		const captcha_id = invoiceSelector.value;
		if(!captcha_id || typeof captcha_id != 'string' || captcha_id.toLowerCase().trim() == 'free') return;
		console.log('loadChannelSelector() - captcha_id found.');
		// fetch the channels for this account.
		const formData = new FormData();
		formData.append('captcha_id', captcha_id);
		formData.append('secret', app.getInvoiceSecret(captcha_id));

		const server_url = app.getSetting('server_url');
		console.log({server_url});
		if(!server_url || typeof server_url != 'string' || !server_url.startsWith('http')){
			app.feed('No server URL set.', true);
			return;
		}
		const getChannelsEndpoint = `${server_url}/get_my_channels`;
		fetch(getChannelsEndpoint, {
			method: 'POST',
			body: formData
		})
		.then(response => {
			if (response.ok) {
				return response.text();
			} else {
				throw new Error('Network response was not ok');
			}
		})
		.then(json => {
			const data = typeof json == 'string'? JSON.parse(json): json;
			if(!data || typeof data != 'object'){
				app.feed('Server response parse failed.', true);
				return;
			}
			console.log({data});
			const channels = data.channels || [];
			const channelSelector = document.getElementById('create_thread_channel_selector');
			channelSelector.innerHTML = '<option value="">None</option>';
			channels.forEach((channel) => {
				const option = document.createElement('option');
				option.value = channel;
				option.textContent = channel;
				channelSelector.appendChild(option);
			});
		});
	}
	document.getElementById('create_thread_toggle_link').addEventListener('click', () => {
		// toggle #create_thread_form
		const form = document.getElementById('create_thread_form');
		const link = document.getElementById('create_thread_toggle_link');
		const form_is_visible = form.style.display !== 'none';
		if (form_is_visible){
			link.textContent 	= '⨤ Create Thread';
			form.style.display 	= 'none';
		} else {
			// Add invoice captcha_ids to .invoice_selector dropdown
			load_invoice_selectors();
			link.textContent 		= '🗙 Hide Form';
			form.style.display		= 'block';
			setTimeout(() => {
				const channelContainer = document.getElementById('create_thread_channel_container');
				const invoiceSelector = document.getElementById('create_thread_invoice_selector');
				if(!channelContainer) return;
				if(invoiceSelector && invoiceSelector.value === 'free'){
					channelContainer.style.display = 'none';
				}else{
					channelContainer.style.display = 'block';
					loadChannelSelector();
				}
			}, 300);
		}
	});
	document.getElementById('create_thread_invoice_selector').addEventListener('change', (event) => {
		const selected = event.target.value;
		if(selected === 'free'){
			document.getElementById('create_thread_channel_container').style.display = 'none';
		}else{
			document.getElementById('create_thread_channel_container').style.display = 'block';
			loadChannelSelector();
		}
	});
	document.getElementById('create_thread_channel_selector').addEventListener('change', (event) => {
		event.preventDefault();
		const selected = event.target.value;
		const threadChannelInput = document.getElementById('thread_channel_input');
		threadChannelInput.value = selected.trim();
	});
});