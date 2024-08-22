/* App State */
class AppState {
	constructor() {
		this.state				= {};
		this.settingsSchema 	= {};
		this.passCache			= {}; // Password attempts by thread id
		this.settingsDefault 	= {
		    server_url:             "https://catsupnorth.com",
			thread_refresh_rate: 	3000,
			autoload_threads: 		false,
			url_preview_max_len: 	50,
			min_spend_threshold: 	1
		};
		for (let key in this.settingsDefault) this.settingsSchema[key] = typeof this.settingsDefault[key];
		this.settingsSchema.server_url = 'string';
		this.loadState();
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

			this.rebuildSettingsForm();
			this.rebuildInvoiceList();

			chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => { 
				if (tabs.length > 0){
					this.updateCurrentUserURL(tabs[0].url, false);
					this.getThreads(this.state.current_user_url);
				}
			});
		});
	}

	// Save the current state to chrome.storage.local
	saveState() {
		chrome.storage.local.set(this.state, () => {
			if (chrome.runtime.lastError) {
				console.error('Error saving state:', chrome.runtime.lastError);
			}
		});
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
			server_url:		this.getSettings().server_url.toString()
		};
		document.getElementById('recovery_phrase').value = '';
		this.saveState();
		this.rebuildInvoiceList();
	}
	
	buyKeys(val, curr) {
		const settings 	= this.getSettings();
		const buyEndpoint 	= `${settings.server_url}/buy?val=${encodeURIComponent(val)}&cur=${encodeURIComponent(curr)}`;
		fetch(buyEndpoint)
			.then(response => {
				if (response.ok) {
					return response.text();
				} else {
					throw new Error('Network response was not ok');
				}
			})
			.then(jsonData => { //  Expected: { "captcha_id": None, "secret": None, "error": None }
				const data = JSON.parse(jsonData);
				const captchaId 		= data.captcha_id 		|| null;
				const secret			= data.secret			|| null;
				const error 			= data.error			|| null;
				const recovery_phrase	= data.recovery_phrase	|| null;
				const settings 			= this.getSettings();
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
				form.action = `${settings.server_url}/request_invoice_creation`;
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
				form.submit();
				document.body.removeChild(form);
			})
			.catch(error => {
				this.feed('There has been a problem with your fetch operation. See console.', true);
				console.error(error);
			});
	}

	recoverInvoice(form){
		const settings 			= this.getSettings();
		const recoverEndpoint 	= `${settings.server_url}/recover_invoice`;
		const formObj			= new FormData(form);
		fetch(recoverEndpoint, {
			method: 'POST',
			body: formObj
		}).then(response => {
			if (response.ok) {
				return response.text();
			} else {
				throw new Error('Network response was not ok');
			}
		}).then(json => {
			const data = JSON.parse(json);
			if (data.error) {
				this.feed(`Error: ${data.error}`, true);
			} else {
				this.feed(data.msg);
				this.addInvoice(data.captcha_id, data.secret, data.face_value, data.face_currency, document.getElementById('recovery_phrase').value);
				this.saveState();
				this.rebuildInvoiceList();
				setTimeout(() => {
					const redeemLink = document.querySelector(`.invoice_redeem_link[data-captcha-id="${data.captcha_id}"]`);
					redeemLink.parentElement.style.backgroundColor = 'lightgreen';
					if (redeemLink) redeemLink.click();
				},300);
				const invoiceContainer = document.getElementById('invoice_container');
				const feedbackAlt = document.createElement('div');
				feedbackAlt.textContent = data.msg;
				invoiceContainer.appendChild(feedbackAlt);
			}
		}).catch(error => {
			this.feed('There has been a problem with your fetch operation. See console.', true);
			console.error(error);
		});
	}

	rollupInvoices(form){
		const settings 			= this.getSettings();
		const recoverEndpoint 	= `${settings.server_url}/recover_invoice`;
		const formObj			= new FormData(form);
		return null;
	}

	// Create a thread
	createThread(captcha_id, description, password, css) {
		this.sendChat(captcha_id, description, 0, 0, 0, password, css);
	}

	// send chat or create threda (reply_to is zero)
	sendChat(captcha_id, content, reply_to = 0, thread_id = 0, spend = 0, password = null, css = null){
		const settings 		= this.getSettings();
		const currentURL 	= this.getCurrentURL();
		const chatEndpoint 	= `${settings.server_url}/send_chat`;
		const formData 		= new FormData();
		if(!password) password = this.getCachedPass(thread_id);
		formData.append('captcha_id', captcha_id);
		formData.append('secret', this.state.invoices[captcha_id].secret);
		formData.append('content', content.toString());
		formData.append('spend', spend)
		formData.append('url', currentURL);
		formData.append('reply_to', reply_to);
		formData.append('thread_id', thread_id);
		formData.append('password', password);
		formData.append('css', css);
		fetch(chatEndpoint, {
			method: 'POST',
			body: formData
		}).then(response => {
			if (response.ok) {
				return response.text();
			} else {
				throw new Error('Network response was not ok');
			}
		}).then(json => {
			const data = JSON.parse(json);
			if (data.error) {
				this.feed(`Error: ${data.error}`, true);
			} else {
				this.feed('Message sent.');
			}
			const create_thread_form = document.getElementById('create_thread_form');
			const currentThreadIdContainer = document.getElementById('cur_thread_id_container');
			var currentThreadId = null;
			if(currentThreadIdContainer){
				currentThreadId = currentThreadIdContainer.textContent;
				currentThreadId = !isNaN(currentThreadId*1)? currentThreadId*1: 0;
			}
			if(currentThreadId){
				this.loadThread(currentThreadId,this.getCachedPass(currentThreadId));
			}else if(create_thread_form.style.display !== 'none'){
				document.getElementById('create_thread_toggle_link').click();
				document.getElementById('thread_content_input').value = '';
				this.getThreads();
			}else{
				this.feed("ERROR: Thread ID not found.", true);
			}
			// TODO: Auto-redeem invoices when chats come back 
		}).catch(error => {
			this.feed('There has been a problem with your post operation. See console.', true);
			console.error(error);
		});
	}
	
	reactDiv(chat_id){
		const container = document.createElement('div');
		const heightFixer = document.createElement('span');
		heightFixer.classList.add('reaction_height_fixer');
		heightFixer.innerHTML = '&nbsp;';
		container.appendChild(heightFixer);
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
		dislikeButton.style.paddingLeft = '10px';
		const dislikeCount = document.createElement('span');
		dislikeCount.classList.add('reaction_count');
		dislikeCount.classList.add('dislike_count');
		dislikeCount.textContent = '0';
		dislikeCount.setAttribute('data-chat-id', chat_id);
		linkSpan.appendChild(likeButton);
		linkSpan.appendChild(likeCount);
		linkSpan.appendChild(dislikeButton);
		linkSpan.appendChild(dislikeCount);
		container.appendChild(linkSpan);
		return container;
	}

	updateReactions(reactions){
		if(!reactions || !Array.isArray(reactions)) return;

		// Get invoice_ids for invoices that have secrets
		var my_invoice_ids = [];
		for (let name in this.state.invoices) {
			if(this.state.invoices[name].secret && typeof this.state.invoices[name].secret == 'string' && this.state.invoices[name].secret.length > 0){
				var invoice = this.state.invoices[name];
				if(!('repo' in invoice) || !invoice.repo || typeof invoice.repo != 'string' || invoice.repo.length < 3) continue
				var repo_split = invoice.repo.split(' ');
				if(repo_split.length < 1 || isNaN(repo_split[0]*1)) continue;
				my_invoice_ids.push(repo_split[0]*1);
			}
		}
		if(my_invoice_ids.length <= 0){ // User cannot react without a secret
			const likeButtons = document.querySelectorAll('.reaction_button');
			likeButtons.forEach((button) => {
				button.addEventListener('click', (event) => {
					event.preventDefault();
					this.feed('You must have an invoice secret.', true);
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
						if(my_invoice_ids.indexOf(inv) > -1) btn.classList.add('my_reaction');
						break;
					case 'down':
						var btn = document.querySelector(`.dislike_button[data-chat-id="${chatId}"]`);
						var cnt = document.querySelector(`.dislike_count[data-chat-id="${chatId}"]`);
						if(cnt && !isNaN(cnt.textContent*1)) cnt.textContent = (cnt.textContent*1 + 1).toString();
						if(my_invoice_ids.indexOf(inv) > -1) btn.classList.add('my_reaction');
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
			button.addEventListener('click', (event) => {
				event.preventDefault();
				if(event.currentTarget.classList.contains('my_reaction')) return; // user already reacted
				event.currentTarget.classList.add('my_reaction');
				const counter = event.currentTarget.nextElementSibling;
				if(counter.classList.contains('reaction_count') && !isNaN(counter.textContent*1)){
					// preemtively increment the counter
					counter.textContent = (counter.textContent*1 + 1).toString();
				}

				// If the user liked and had already disliked, remove the dislike
				const findClass = event.currentTarget.classList.contains('like_button')? 'dislike_button': 'like_button';
				const sibling = event.currentTarget.parentElement.querySelector(`.reaction_button.${findClass}`);
				if(sibling && sibling.classList.contains('reaction_button') && sibling.classList.contains('my_reaction')){
					sibling.classList.remove('my_reaction');
					const siblingCounter = sibling.nextElementSibling;
					if(siblingCounter.classList.contains('reaction_count') && !isNaN(siblingCounter.textContent*1) && siblingCounter.textContent*1 > 0){
						siblingCounter.textContent = (siblingCounter.textContent*1 - 1).toString();
					}
				}
				const settings = this.getSettings();
				const reactEndpoint = `${settings.server_url}/chat_react`;
				const formData = new FormData();
				const chatId = event.currentTarget.getAttribute('data-chat-id');
				const reaction = event.currentTarget.classList.contains('like_button')? 'up': 'down';
				formData.append('chat_id', chatId);
				formData.append('vote', reaction);
				for(var name in app.state.invoices){
					if(!name || name.length < 1) continue;
					var inv = app.state.invoices[name];
					if(!inv || !inv.secret || typeof inv.secret !== 'string' || inv.secret.length < 1) continue;
					if(!inv.repo || typeof inv.repo !== 'string' || inv.repo.length < 1) continue;
					formData.append('captcha_id', name);
					formData.append('secret', inv.secret);
				}
				fetch(reactEndpoint, {
					method: 'POST',
					body: formData
				}).then(response => {
					if (response.ok) {
						return response.text();
					} else {
						throw new Error('Network response was not ok');
					}
				}).then(json => {
					const data = JSON.parse(json);
					if (data.error) {
						this.feed(`Error: ${data.error}`, true);
					} else {
						this.feed(data.msg);
					}
				}).catch(error => {
					this.feed('There has been a problem with your fetch operation. See console.', true);
					console.error(error);
				});
			});
		});
	}

	loadThread(threadId, password = null){
		document.getElementById('create_thread_container').style.display = 'none';
		// TODO Change to post to allow for password and css
		const settings = this.getSettings();
		const threadContainer = document.getElementById('thread_container');
		//fetch(`${settings.server_url}/get_thread_chats?thread_id=${threadId}`)
		// change to post
		const formData = new FormData();
		formData.append('thread_id', threadId);
		if (password) formData.append('password', password);
		const threadEndpoint = `${settings.server_url}/get_thread_chats`;
		var test = {};
		formData.forEach(function(value, key){
			test[key] = value;
		});
		test = JSON.stringify(test);
		fetch(threadEndpoint, {
			method: 'POST',
			body: formData
		}).then(response => {
			if (response.ok) {
				return response.text();
			} else {
				throw new Error('Network response was not ok');
			}
		}).then(json => {
			const data = JSON.parse(json);
			if (data.error) {
				this.feed(`Error: ${data.error}`, true);
				return;
			}
			this.feed(data.msg);
			const threadChats = data.chats;
			// TODO: Sort by date updated
			const backLink = document.createElement('a');
			backLink.textContent = 'Go back to threads';
			backLink.href = '#';
			backLink.addEventListener('click', (event) => {
				this.getThreads();
			})
			const threadLabel = document.createElement('h2');
			threadLabel.innerHTML = `Thread <span id="cur_thread_id_container">${threadId}</span>`;
			threadContainer.innerHTML = '';
			threadContainer.appendChild(backLink);
			threadContainer.appendChild(document.createElement('br'));
			threadContainer.appendChild(document.createElement('br'));
			threadContainer.appendChild(threadLabel);
			threadContainer.appendChild(document.createElement('br'));
			threadContainer.appendChild(document.createElement('br'));
			threadChats.forEach(chat => {
				const chatDiv = document.createElement('div');
				chatDiv.classList.add('chat');
				const reply_to_link	= chat.reply_to_id? `<a href="#chat_id_${chat.reply_to_id}">^${chat.reply_to_id}</a>`: '';
				const alias_str 	= (chat.alias && typeof chat.alias == 'string')? `&nbsp;&nbsp;<strong style="color:#183f36;">${chat.alias}</strong>`: '';
				chatDiv.innerHTML 	= `<strong>${chat.chat_id}${reply_to_link}</strong>${alias_str}`;
				// Reply Form and link to toggle reply form
				const replyLink = document.createElement('a');
				replyLink.appendChild(this.heroicon('megaphone'));
				replyLink.title = 'Reply';
				replyLink.classList.add('pull-right');
				replyLink.href = '#';
				replyLink.addEventListener('click', (event) => {
					event.preventDefault();
					const form = chatDiv.querySelector('.reply_form');
					form.style.display = form.style.display === 'none'? 'block': 'none';
				});
				const replyForm = document.createElement('form');
				replyForm.style.display = 'none';
				replyForm.classList.add('reply_form');
				replyForm.innerHTML = `
					<input type="hidden" name="thread_id" value="${threadId}">
					<select name="captcha_id" class="invoice_selector"></select>
					<input type="hidden" name="reply_to" value="${chat.chat_id}">
					<textarea name="content" placeholder="Reply..."></textarea>
					<input type="number" name="spend" placeholder="Super Chat Spend in USD (optional)">
					<input type="submit" name="reply" value="Reply">
					<input type="submit" name="private_reply" value="Send as Private Message">
				`;
				replyForm.addEventListener('submit', (event) => {
					event.preventDefault();
					const formData = new FormData(event.target);
					const formObject = {is_private: (event.submitter.name === 'private_reply' ? 1 : 0)};
					formData.forEach((value, key) => {
						formObject[key] = value;
					});
					this.sendChat(formObject.captcha_id, formObject.content, formObject.reply_to, threadId, formObject.spend);
				});
				chatDiv.appendChild(replyLink);
				const chatContent = document.createElement('span');
				chatContent.textContent = chat.chat_content;
				chatDiv.appendChild(document.createElement('br'));
				chatDiv.appendChild(chatContent);
				chatDiv.appendChild(replyForm);

				// Likes and dislikes
				chatDiv.appendChild(app.reactDiv(chat.chat_id));

				threadContainer.appendChild(chatDiv);
				setTimeout(load_invoice_selectors,50);
			});
			app.updateReactions(data.reactions);
		})
		.catch(error => {
			this.feed('There has been a problem with your fetch operation. See console.', true);
			console.error(error);
		});
	}

	getThreads(url_arg){
		document.getElementById('create_thread_container').style.display = 'inline-block';
		this.feed("");
		if(url_arg) this.updateCurrentUserURL(url_arg);
		const url = this.getCurrentURL();
		if(!url){
			this.feed("No URL to fetch threads for.", true);
			return;
		}
		// send this to the get_threads endpoint
		const settings = this.getSettings();
		const getThreadsURL = `${settings.server_url}/get_threads?url=${encodeURIComponent(url)}`;
		fetch(getThreadsURL)
			.then(response => {
				if (response.ok) {
					return response.text();
				} else {
					throw new Error('Network response was not ok');
				}
			})
			.then(json => {
				const data = JSON.parse(json);
				if (data.error) {
					this.feed(`Error: ${data.error}`, true);
					return;
				}
				this.feed(data.msg);
				const threads = data.threads;
				const threadContainer = document.getElementById('thread_container');
				threadContainer.innerHTML = '';
				threads.forEach(thread => {
					const threadDiv = document.createElement('div');
					threadDiv.classList.add('thread');
					var alias_str = '';
					if('alias' in thread && thread.alias && typeof thread.alias == 'string'){
						alias_str = `&nbsp;&nbsp;<strong style="color:#183f36;">${thread.alias}</strong>`;
					}
					const password_xml = thread.password_required? this.heroicon('lock-closed').outerHTML: '';
					const loadThreadLink = document.createElement('a');
					loadThreadLink.innerHTML = `<strong style="color:grey;">${thread.thread_id}.${thread.chat_id}</strong>${alias_str}<span class="pull-right">${password_xml}</span><br>${thread.chat_content}`;
					loadThreadLink.setAttribute('data-thread-id', thread.thread_id);
					loadThreadLink.classList.add('thread_opener');
					if(thread.password_required) loadThreadLink.classList.add('password_required');
					loadThreadLink.addEventListener('click', (e) => {
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
					threadDiv.appendChild(app.reactDiv(thread.chat_id,data.reactions));

					threadContainer.appendChild(threadDiv);
				});
				app.updateReactions(data.reactions);
			})
			.catch(error => {
				this.feed('There has been a problem with your fetch operation. See console.', true);
				console.error(error);
			});
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
					validSettings[key] = newSettings[key]*1;
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
			this.state.settings = { ...this.state.settings, ...validSettings };
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

	getSettings() {
		return this.state.settings;
	}

	getCurrentURL() {
		return this.state.current_user_url;
	}
	
	getShortURL(){
		const settings 	= this.getSettings();
		const url 		= this.getCurrentURL();
		var shortUrl 	=  url.substr(0,settings.url_preview_max_len);
		return url.length > settings.url_preview_max_len? shortUrl + "...": url + "";
	}

	// GUI Output
	updateCurrentUserURL(url, save_state = true) {
		this.state.current_user_url 						= url.toString();
		document.getElementById('current_url').title 		= this.getCurrentURL();
		document.getElementById('current_url').innerHTML 	= this.getShortURL();
		this.saveState();
	}
	
	feed(arg, err = false){
		if(err) console.trace(arg,err);
		const f 		= document.getElementById('feed');
		f.innerHTML 	= arg.toString();
		f.title		 	= arg.toString();
		f.style.color 	= err? "rgb(255,0,0)": "rgb(1,64,54)";
	}
	
	rebuildSettingsForm() {
        const form = document.getElementById('settings_form');
        form.innerHTML = ''; // Clear the form

        for (let key in this.state.settings) {
            const label = document.createElement('label');
            label.textContent = key.replace(/_/g, ' ').toUpperCase();
            form.appendChild(label);

            let input;
            if (typeof this.state.settings[key] === 'boolean') {
                input = document.createElement('select');
                ['true', 'false'].forEach(optionValue => {
                    const option = document.createElement('option');
                    option.value = optionValue;
                    option.text = optionValue.charAt(0).toUpperCase() + optionValue.slice(1);
                    if (String(this.state.settings[key]) === optionValue) {
                        option.selected = true;
                    }
                    input.appendChild(option);
                });
            } else {
                input = document.createElement('input');
                input.type = typeof this.state.settings[key] === 'number' ? 'number' : 'text';
                input.value = this.state.settings[key];
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
			}
        }

        // Add the submit button
        const submitButton = document.createElement('button');
        submitButton.type = 'submit';
        submitButton.textContent = 'Save Settings';
        form.appendChild(submitButton);
    }
	
	rebuildInvoiceList(){
		const container = document.getElementById('invoice_container');
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
			if (this.state.invoices[name].server_url !== this.getSettings().server_url) {
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

			// Create and append invoice details
			const nameElement = document.createElement('strong');
			nameElement.textContent = name;
			invoiceDiv.appendChild(nameElement);
			invoiceDiv.appendChild(document.createElement('br'));

			const urlElement = document.createElement('a');
			urlElement.textContent = `${invoice.server_url.replace('https://','').replace('http://','')}`;
			urlElement.href = invoice.server_url;
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
			balanceElement.textContent = `Balance: ${invoice.balance} Satoshis`;
			if("conv_balance" in invoice && invoice.conv_balance && "currency_pair" in invoice && invoice.currency_pair){
				if(!isNaN(invoice.conv_balance*1)){
					const twoDecimalConvBalance = (invoice.conv_balance*1).toFixed(2);
					const convCurrency = invoice.currency_pair.split('_')[1];
					balanceElement.textContent += ` (~${twoDecimalConvBalance} ${convCurrency})`;
				}
			}
			invoiceDiv.appendChild(balanceElement);

			const createdElement = document.createElement('p');
			createdElement.textContent = `Created: ${invoice.created}`;
			invoiceDiv.appendChild(createdElement);

			if(invoice.repo){
				const repoElement = document.createElement('a');
				repoElement.textContent = `Seed`;
				repoElement.href = '#';
				repoElement.addEventListener('click', (e) => {
					e.preventDefault();
					navigator.clipboard.writeText(invoice.repo);
					this.feed('Recovery Phrase copied to clipboard.');
					e.target.style.opacity = 0;
					setTimeout(() => e.target.style.opacity = 1, 700); 
				});
				invoiceDiv.appendChild(repoElement);
			}else{
				const repoElement = document.createElement('span');
				repoElement.textContent = `No Recovery Phrase`;
				invoiceDiv.appendChild(repoElement);
			}

			if(invoice.link){
				const invoiceLink = document.createElement('a');
				invoiceLink.textContent = `Open`;
				invoiceLink.href = invoice.link;
				invoiceLink.target = '_blank';
				invoiceLink.style.paddingLeft = '10px';
				invoiceDiv.appendChild(invoiceLink);
			}

			const redeemLink = document.createElement('a');
			redeemLink.textContent = `Redeem`;
			redeemLink.href = '#';
			redeemLink.style.paddingLeft = '10px';
			redeemLink.classList.add('invoice_redeem_link');
			redeemLink.setAttribute("data-captcha-id",name);
			redeemLink.setAttribute("data-captcha-id",name);
			redeemLink.addEventListener('click', (e) => {
				// empty the invoice container and add wait message
				const click_target_parent = e.target.parentElement;
				// lock height of parent
				click_target_parent.style.height = click_target_parent.offsetHeight + "px";

				click_target_parent.innerHTML = 'Please wait...';

				// Get the captcha ID from the clicked element
				const captchaId = e.target.getAttribute('data-captcha-id');
				const settings = this.getSettings();
				const redeemEndpoint = `${settings.server_url}/redeem_invoice`;
				const formData = new FormData();
				formData.append('captcha_id', captchaId);
				formData.append('secret', this.state.invoices[captchaId].secret);

				// Send the POST request to redeem the invoice
				fetch(redeemEndpoint, {
					method: 'POST',
					body: formData
				}).then(response => {
					if (response.ok) {
						return response.text();
					} else {
						throw new Error('Network response was not ok');
					}
				}).then(json => {
					const data = JSON.parse(json);
					if(data.error){
						this.feed(`Error: ${data.error.toString()}`, true);
					}if(data.msg){
						this.feed(data.msg);
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
				}).catch(error => {
					this.feed('There has been a problem with your fetch operation. See console.', true);
					console.error(error);
				});
			});
			invoiceDiv.appendChild(redeemLink);

			// Request payout link
			const payoutLink = document.createElement('a');
			payoutLink.textContent = `Payout`;
			payoutLink.href = '#';
			payoutLink.style.paddingLeft = '10px';
			payoutLink.classList.add('invoice_payout_link');
			payoutLink.setAttribute("data-captcha-id",name);
			payoutLink.addEventListener('click', (e) => {
				// Get the captcha ID from the clicked element
				const captchaId 	= e.currentTarget.getAttribute('data-captcha-id');
				const secret 		= this.state.invoices[captchaId].secret
				const sentToAddress = prompt('Enter the BTC address to send the funds to:');
				console.log(sentToAddress, secret, captchaId);
				if (!sentToAddress){
					this.feed("Action Cancelled.");
					return;
				};
				if(typeof sentToAddress !== 'string' || sentToAddress.trim().length < 26){
					this.feed("BTC receiving address must be at least 26 characters.");
					return;
				}
				const settings = this.getSettings();
				const payoutEndpoint = `${settings.server_url}/get_funds`;
				const formData = new FormData();
				formData.append('captcha_id', captchaId);
				formData.append('secret', secret);
				formData.append('send_to_address', sentToAddress.trim());
				// Send the POST request to redeem the invoice
				fetch(payoutEndpoint, {
					method: 'POST',
					body: formData
				}).then(response => {
					if (response.ok) {
						return response.text();
					} else {
						throw new Error('Network response was not ok');
					}
				}).then(json => {
					const data = JSON.parse(json);
					if(data.error){
						this.feed(`Error: ${data.error.toString()}`, true);
						return;
					}
					if(data.msg) this.feed(data.msg);
					const req = data.payout_request;
					console.log({req});
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
				}).catch(error => {
					this.feed('There has been a problem with your fetch operation. See console.', true);
					console.error(error);
				});
			});
			invoiceDiv.appendChild(payoutLink);

			// Append the invoice div to the container
			container.appendChild(invoiceDiv);
		}

		// Tell users how many invoices they have
		document.getElementById('invoice_count_indicator').innerHTML = `Total Invoices: ${total_invoices}<br>Server Invoices: ${server_invoices}`;
		
		// Sort by date created with newest at top.
		const elements = Array.from(container.children);
		elements.sort((a, b) => {
			const dateA = new Date(a.getAttribute('data-date-created'));
			const dateB = new Date(b.getAttribute('data-date-created'));
			return dateA - dateB;
		});
		elements.forEach(element => container.appendChild(element));
	}

	heroicon(name) {
		const svgContainer = document.getElementById('heroicon-' + name);
		if (svgContainer) {
			const svg = svgContainer.querySelector('svg');
			if (svg) return svg.cloneNode(true);
		}
		return false;
	}
}

/* Initialize app state */
const app = new AppState();

/* Extension functionality */
chrome.runtime.onMessage.addListener((message) => {
	if (message.url) app.getThreads(message.url);
});

/* Named functions */

function show_tab(tabId) {
	const tabs = document.querySelectorAll('.tab');
	const tabContents = document.querySelectorAll('.tab-content');

	tabs.forEach(tab => {
		if (tab.id === `tab-${tabId}`) {
			tab.classList.add('active');
		} else {
			tab.classList.remove('active');
		}
	});

	tabContents.forEach(content => {
		if (content.id === tabId) {
			content.classList.add('active');
		} else {
			content.classList.remove('active');
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
		invoiceSelector.innerHTML = '';
		// sort invoices by balance in decending order
		const sortedInvoices = Object.keys(invoices).sort((a, b) => invoices[b].balance - invoices[a].balance );
		for (var j=0; j<sortedInvoices.length; j++){
			var captchaId = sortedInvoices[j];
			var invoice = invoices[captchaId];
			var balance = (invoice.balance && !isNaN(invoice.balance))? invoice.balance: 0;
			if(balance <= 0) continue;
			if(invoice.server_url !== app.getSettings().server_url) continue;
			var cur_bal = '0.00';
			if(balance && 'exchange_rate' in invoice && invoice.exchange_rate && !isNaN(invoice.exchange_rate) && 'currency_pair' in invoice && invoice.currency_pair && typeof invoice.currency_pair == 'string'){
				cur_bal = (balance * invoice.exchange_rate / 100000000).toFixed(2);
			}
			try{
				switch(invoice.currency_pair.split('_')[1]){
					case 'USD': cur_bal = '$' + cur_bal; break;
					case 'EUR': cur_bal = '€' + cur_bal; break;
					case 'GBP': cur_bal = '£' + cur_bal; break;
					case 'JPY': cur_bal = '¥' + cur_bal; break;
					case 'AUD': cur_bal = 'A$' + cur_bal; break;
					case 'CAD': cur_bal = 'C$' + cur_bal; break;
					case 'CHF': cur_bal = 'Fr' + cur_bal; break;
					case 'CNY': cur_bal = '¥' + cur_bal; break;
					case 'SEK': cur_bal = 'kr' + cur_bal; break;
					case 'NZD': cur_bal = 'NZ$' + cur_bal; break;
					case 'KRW': cur_bal = '₩' + cur_bal; break;
					case 'SGD': cur_bal = 'S$' + cur_bal; break;
					case 'NOK': cur_bal = 'kr' + cur_bal; break;
					case 'MXN': cur_bal = 'Mex$' + cur_bal; break;
					case 'HKD': cur_bal = 'HK$' + cur_bal; break;
					case 'TRY': cur_bal = '₺' + cur_bal; break;
					case 'RUB': cur_bal = '₽' + cur_bal; break;
					case 'INR': cur_bal = '₹' + cur_bal; break;
					case 'BRL': cur_bal = 'R$' + cur_bal; break;
					case 'ZAR': cur_bal = 'R' + cur_bal; break;
					case 'IDR': cur_bal = 'Rp' + cur_bal; break;
					case 'MYR': cur_bal = 'RM' + cur_bal; break;
					case 'PHP': cur_bal = '₱' + cur_bal; break;
					case 'THB': cur_bal = '฿' + cur_bal; break;
					case 'VND': cur_bal = '₫' + cur_bal; break;
					case 'PLN': cur_bal = 'zł' + cur_bal; break;
					case 'TWD': cur_bal = 'NT$' + cur_bal; break;
					case 'SAR': cur_bal = 'SR' + cur_bal; break;
					case 'AED': cur_bal = 'د.إ' + cur_bal; break;
					case 'CZK': cur_bal = 'Kč' + cur_bal; break;
					case 'CLP': cur_bal = 'CLP$' + cur_bal; break;
					case 'ILS': cur_bal = '₪' + cur_bal; break;
					case 'KES': cur_bal = 'KSh' + cur_bal; break;
					case 'PKR': cur_bal = '₨' + cur_bal; break;
					case 'QAR': cur_bal = 'QR' + cur_bal; break;
					case 'HUF': cur_bal = 'Ft' + cur_bal; break;
					case 'EGP': cur_bal = 'E£' + cur_bal; break;
					case 'COP': cur_bal = 'COL$' + cur_bal; break;
					case 'ARS': cur_bal = 'AR$' + cur_bal; break;
					case 'DOP': cur_bal = 'RD$' + cur_bal; break;
					case 'CRC': cur_bal = '₡' + cur_bal; break;
					case 'PEN': cur_bal = 'S/.' + cur_bal; break;
					case 'UYU': cur_bal = '$U' + cur_bal; break;
					case 'BOB': cur_bal = 'Bs' + cur_bal; break;
					case 'PYG': cur_bal = '₲' + cur_bal; break;
					default:;
				}
			}catch(e){
				console.error(e);
			}
			const option = document.createElement('option');
			option.value = captchaId;
			option.textContent = `${String(balance).padStart(8,"0")}  |  ${cur_bal}  |  ${captchaId}`;
			invoiceSelector.appendChild(option);
		}
	}
}
/* Listeners */
document.getElementById('tab-home').addEventListener('click', 		() => show_tab('home'));
document.getElementById('tab-buy').addEventListener('click', 		() => show_tab('buy'));
document.getElementById('tab-settings').addEventListener('click', 	() => show_tab('settings'));
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
});
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
	}
});
document.getElementById('create_thread_form').addEventListener('submit', (event) => {
	event.preventDefault();
	const form = event.target;
	const formData = new FormData(form);
	const formObject = {};
	formData.forEach((value, key) => {
		formObject[key] = value;
	});
	app.createThread(formObject.captcha_id,formObject.content,formObject.password,formObject.css);
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