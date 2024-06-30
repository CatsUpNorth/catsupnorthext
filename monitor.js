/* App State */
class AppState {
	constructor() {
		this.state				= {};
		this.settingsSchema 	= {};
		this.settingsDefault 	= {
			server_url: 			"http://localhost:5000",
			thread_refresh_rate: 	3000,
			autoload_threads: 		false,
			url_preview_max_len: 	50,
			min_spend_threshold: 	1
		};
		for (let key in this.settingsDefault) this.settingsSchema[key] = typeof this.settingsDefault[key];
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
				if (tabs.length > 0) this.updateCurrentUserURL(tabs[0].url, false);
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
	
	// Saves invoice to state
	addInvoice(captcha, secret, val, curr){
		this.state.invoices[captcha] = {
			secret:			secret,
			satoshi_paid: 	0,
			btc_paid:		'0.0', 
			balance:		0, // satoshi remaining
			conv_balance:	0, // dollar value of balance
			created:		new Date().toISOString(),
			tokens:			0, // total api calls awarded
			rate_quote:		0,
			val:			val,
			curr:			curr,
			link:			null
		};
		this.rebuildInvoiceList();
		this.saveState();
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
				const captchaId = data.captcha_id 	|| null;
				const secret	= data.secret		|| null;
				const error 	= data.error		|| null;
				const settings 	= this.getSettings();
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
				this.addInvoice(captchaId, secret, val, curr);
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
			console.log({data});
			if (data.error) {
				this.feed(`Error: ${data.error}`, true);
			} else {
				this.feed('Message sent.');
			}
		}).catch(error => {
			this.feed('There has been a problem with your post operation. See console.', true);
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
		console.log(arg,err);
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
		for (let name in this.state.invoices) {

			const invoice = JSON.parse(JSON.stringify(this.state.invoices[name]));
			// Create a div for each invoice
			const invoiceDiv = document.createElement('div');
			invoiceDiv.setAttribute("data-captcha-id",name);
			invoiceDiv.setAttribute("data-date-created",invoice.created);
			invoiceDiv.classList.add('invoice');

			const api_calls = (typeof invoice.rate_quote == 'int' && invoice.rate_quote > 0)? Math.floor(invoice.balance / invoice.rate_quote): 0;

			/*	
				app.state.invoices[name] = {
					secret:			secret,
					satoshi_paid: 	0,
					btc_paid:		'0.0', 
					balance:		0, // satoshi remaining
					created:		new Date().toISOString(),
					tokens:			0, // total api calls awarded
					rate_quote:		0,
					val:			val,
					curr:			curr,
					link:			null,
					rows_remaining:	0
				};
			*/

			// Create and append invoice details
			const nameElement = document.createElement('strong');
			nameElement.textContent = name;
			invoiceDiv.appendChild(nameElement);

			const faceValueElement = document.createElement('p');
			faceValueElement.textContent = `Purchase Price: ${invoice.val} ${invoice.curr}`;
			invoiceDiv.appendChild(faceValueElement);

			const btcPaidElement = document.createElement('p');
			btcPaidElement.textContent = `BTC Paid: ${invoice.btc_paid}`;
			invoiceDiv.appendChild(btcPaidElement);

			const rateQuoteElement = document.createElement('p');
			rateQuoteElement.textContent = `Rate Quote: ${invoice.rate_quote} Satoshis per API call.`;
			invoiceDiv.appendChild(rateQuoteElement);

			const balanceElement = document.createElement('p');
			balanceElement.textContent = `Balance: ${invoice.balance} Satoshis`;
			if(!isNaN(invoice.conv_balance*1)){
				const twoDecimalConvBalance = (invoice.conv_balance*1).toFixed(2);
				const convCurrency = invoice.currency_pair.split('_')[1];
				balanceElement.textContent += ` (~${twoDecimalConvBalance} ${convCurrency})`;
			}
			invoiceDiv.appendChild(balanceElement);

			const apiCallsAvailable = document.createElement('p');
			apiCallsAvailable.textContent = `API Calls Available: ${api_calls}`;
			invoiceDiv.appendChild(apiCallsAvailable);

			const rowsRemainingElement = document.createElement('p');
			rowsRemainingElement.textContent = `Chats Immediately Available: ${invoice.rows_remaining}`;
			invoiceDiv.appendChild(rowsRemainingElement);

			const createdElement = document.createElement('p');
			createdElement.textContent = `Created: ${invoice.created}`;
			invoiceDiv.appendChild(createdElement);

			const exchangeRateElement = document.createElement('p');
			exchangeRateElement.textContent = `Exchange Rate: ${invoice.exchange_rate} ${invoice.currency_pair}`;
			invoiceDiv.appendChild(exchangeRateElement);

			const invoiceLink = document.createElement('a');
			invoiceLink.textContent = `Open`;
			invoiceLink.href = invoice.link;
			invoiceLink.target = '_blank';
			invoiceLink.style.paddingRight = '10px';
			invoiceDiv.appendChild(invoiceLink);

			const redeemLink = document.createElement('a');
			redeemLink.textContent = `Redeem`;
			invoiceLink.style.paddingLeft = '10px';
			redeemLink.setAttribute("data-captcha-id",name);
			redeemLink.addEventListener('click', (e) => {
				// empty the invoice container and add wait message
				const invoice_container = document.getElementById('invoice_container');
				invoice_container.innerHTML = '';
				const waitMessage = document.createElement('p');
				waitMessage.textContent = 'Please wait...';
				invoice_container.appendChild(waitMessage);

				// Get the captcha ID from the clicked element
				const captchaId = e.target.getAttribute('data-captcha-id');
				const settings = this.getSettings();
				const redeemEndpoint = `${settings.server_url}/redeem_invoice`;
				const formData = new FormData();
				formData.append('captcha_id', captchaId);
				formData.append('secret', app.state.invoices[captchaId].secret);
				console.log(captchaId);
				console.log(app.state.invoices[captchaId].secret);

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
					/* expects {
						"msg": 				"", 
						"satoshi_paid": 	0,
						"btc_paid":			"0.0",
						"btc": 				0.0,
						"error":			None
						"link":				None,
						"msg":				"",
						"rate_quote":		0,
						"rows_remaining":	0,
						"exchange_rate":	0.0,
						"currency_pair":	""
					} */
					const data = JSON.parse(json);
					console.log({data});
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

			// Append the invoice div to the container
			container.appendChild(invoiceDiv);
		}
		
		// Sort by date created with newest at top.
		const elements = Array.from(container.children);
		elements.sort((a, b) => {
			const dateA = new Date(a.getAttribute('data-date-created'));
			const dateB = new Date(b.getAttribute('data-date-created'));
			return dateA - dateB;
		});
		elements.forEach(element => container.appendChild(element));
	}
}

/* Initialize app state */
const app = new AppState();

/* Extension functionality */
chrome.runtime.onMessage.addListener((message) => {
	if (message.url) {
		app.updateCurrentUserURL(message.url);
		document.getElementById('thread_container').innerHTML = '';
		document.getElementById('thread_loader').style.display = 'inline';
		app.feed("");
	}
});

/* Named functions */
function showTab(tabId) {
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
}

function load_invoice_selectors(){
	const invoices 			= app.getInvoices();
	const invoiceSelectors 	= document.getElementsByClassName('invoice_selector');
	for (let i = 0; i < invoiceSelectors.length; i++) {
		const invoiceSelector = invoiceSelectors[i];
		invoiceSelector.innerHTML = '';
		for (let captchaId in invoices) {
			const option = document.createElement('option');
			option.value = captchaId;
			option.textContent = captchaId;
			invoiceSelector.appendChild(option);
		}
	}
}

function load_thread(threadId){
	// TODO Change to post to allow for password and css
	const threadContainer = document.getElementById('thread_container');
	fetch(`${settings.server_url}/get_thread_chats?thread_id=${threadId}`)
		.then(response => {
			if (response.ok) {
				return response.text();
			} else {
				throw new Error('Network response was not ok');
			}
		})
		.then(json => {
			const data = JSON.parse(json);
			console.log({data});
			if (data.error) {
				app.feed(`Error: ${data.error}`, true);
				return;
			}
			app.feed(data.msg);
			const threadChats = data.chats;
			threadContainer.innerHTML = '';
			threadChats.forEach(chat => {
				const chatDiv = document.createElement('div');
				chatDiv.classList.add('chat');
				const replyToLink = chat.reply_to_id? `<a href="#chat_id_${chat.reply_to_id}" style="padding-left:4px;">^${chat.reply_to_id}</a>`: '';
				chatDiv.innerHTML = `<p><strong>${chat.chat_id}${replyToLink}</strong><br>${chat.chat_content}</p>`;
				// Reply Form and link to toggle reply form
				const replyLink = document.createElement('a');
				replyLink.textContent = 'Reply';
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
					<select name="captcha_id" class="invoice_selector"></select>
					<input type="hidden" name="reply_to" value="${chat.chat_id}">
					<textarea name="content" placeholder="Reply..."></textarea>
					<input type="number" name="spend" placeholder="Super Chat Spend in USD (optional)">
					<input type="checkbox" name="is_private" value="1"> Private Message
					<input type="submit" value="Reply">
				`;
				replyForm.addEventListener('submit', (event) => {
					event.preventDefault();
					const formData = new FormData(event.target);
					const formObject = {};
					formData.forEach((value, key) => {
						formObject[key] = value;
					});
					app.sendChat(formObject.captcha_id, formObject.content, formObject.reply_to, threadId, 0, formObject.password, formObject.css);
				});
				load_invoice_selectors();
				chatDiv.appendChild(replyForm);
				threadContainer.appendChild(chatDiv);
			});
		})
		.catch(error => {
			app.feed('There has been a problem with your fetch operation. See console.', true);
			console.error(error);
		});
	}


/* Listeners */
document.getElementById('tab-home').addEventListener('click', () => showTab('home'));
document.getElementById('tab-buy').addEventListener('click', () => showTab('buy'));
document.getElementById('tab-settings').addEventListener('click', () => showTab('settings'));
document.getElementById('buy_form').addEventListener('submit', (event) => {
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
document.getElementById('all_thread_loader').addEventListener('click', () => {
	const url = app.getCurrentURL();
	// send this to the get_threads endpoint
	const settings = app.getSettings();
	const threadEndpoint = `${settings.server_url}/get_threads?url=${encodeURIComponent(url)}`;
	fetch(threadEndpoint)
		.then(response => {
			if (response.ok) {
				return response.text();
			} else {
				throw new Error('Network response was not ok');
			}
		})
		.then(json => {
			const data = JSON.parse(json);
			console.log({data});
			if (data.error) {
				app.feed(`Error: ${data.error}`, true);
				return;
			}
			app.feed(data.msg);
			const threads = data.threads;
			const threadContainer = document.getElementById('thread_container');
			threadContainer.innerHTML = '';
			threads.forEach(thread => {
				const threadDiv = document.createElement('div');
				threadDiv.classList.add('thread');
				threadDiv.innerHTML = `<p>${thread.chat_content}</p>`;
				threadContainer.appendChild(threadDiv);
				loadThreadLink = document.createElement('a');
				loadThreadLink.textContent = 'Load Thread';
				loadThreadLink.setAttribute('data-thread-id', thread.thread_id);
				loadThreadLink.addEventListener('click', () => {
					// Get thread chats from the /get_thread_chats endpoint
					const threadId = loadThreadLink.getAttribute('data-thread-id');
					load_thread(threadId);
				});
				threadDiv.appendChild(loadThreadLink);
			});
		})
		.catch(error => {
			app.feed('There has been a problem with your fetch operation. See console.', true);
			console.error(error);
		});
});