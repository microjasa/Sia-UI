import { takeEvery } from 'redux-saga'
import { put, take } from 'redux-saga/effects'
import { siadCall, parseRawTransactions } from './helpers.js'
import * as actions from '../actions/wallet.js'
import * as constants from '../constants/wallet.js'
import { walletUnlockError } from '../actions/error.js'

// Send an error notification.
const sendError = (e) => {
	SiaAPI.showError({
		title: 'Sia-UI Wallet Error',
		content: typeof e.message !== 'undefined' ? e.message : e.toString(),
	})
}

// Wallet plugin sagas
// Sagas are an elegant way of handling asynchronous side effects.
// All side effects logic is contained entirely in this file.
// See https://github.com/yelouafi/redux-saga to read more about redux-saga.

//  Call /wallet and dispatch the appropriate actions from the returned JSON.
function *getLockStatusSaga() {
	try {
		const response = yield siadCall('/wallet')
		if (!response.unlocked) {
			yield put(actions.setLocked())
		} else {
			yield put(actions.setUnlocked())
		}
		if (response.encrypted) {
			yield put(actions.setEncrypted())
		} else {
			yield put(actions.setUnencrypted())
		}
	} catch (e) {
		console.error('error fetching lock status: ' + e.toString())
	}
}

// Call /wallet/unlock and dispatch setEncrypted and setUnlocked.
// Since siadCall is a promise which rejects on error, API errors will be caught.
// Dispatch any API errors as a walletUnlockError action.
function *walletUnlockSaga(action) {
	try {
		yield siadCall({
			url: '/wallet/unlock',
			method: 'POST',
			timeout: 12000000, // 20 minute timeout for unlocking
			qs: {
				encryptionpassword: action.password,
			},
		})
		yield put(actions.setEncrypted())
		yield put(actions.setUnlocked())
		yield put(actions.handlePasswordChange(''))
	} catch (e) {
		yield put(actions.handlePasswordChange(''))
		yield put(walletUnlockError(e.message))
	}
}

function *walletLockSaga() {
	try {
		yield siadCall({
			url: '/wallet/lock',
			method: 'POST',
		})
		yield put(actions.setEncrypted())
		yield put(actions.setLocked())
	} catch (e) {
		sendError(e)
	}
}

// Call /wallet/init to create a new wallet, show the user the newWalletDialog,
// Wait for the user to close the dialog, then unlock the wallet using the primary seed.
function *createWalletSaga() {
	try {
		const response = yield siadCall({
			url: '/wallet/init',
			method: 'POST',
			qs: {
				dictionary: 'english',
			},
		})
		yield put(actions.showNewWalletDialog(response.primaryseed, response.primaryseed))
		yield take(constants.SET_UNLOCKED)
		yield put(actions.dismissNewWalletDialog())
	} catch (e) {
		sendError(e)
	}
}

// call /wallet and compute the confirmed balance as well as the unconfirmed delta.
function *getBalanceSaga() {
	try {
		const response = yield siadCall('/wallet')
		const confirmed = SiaAPI.hastingsToSiacoins(response.confirmedsiacoinbalance)
		const unconfirmedIncoming = SiaAPI.hastingsToSiacoins(response.unconfirmedincomingsiacoins)
		const unconfirmedOutgoing = SiaAPI.hastingsToSiacoins(response.unconfirmedoutgoingsiacoins)
		const unconfirmed = unconfirmedIncoming.minus(unconfirmedOutgoing)
		yield put(actions.setBalance(confirmed.round(2).toString(), unconfirmed.round(2).toString(), response.siafundbalance))
	} catch (e) {
		console.error('error fetching balance: ' + e.toString())
	}
}

// Get all the transactions from /wallet transactions, parse them, and dispatch setTransactions()
function *getTransactionsSaga() {
	try {
		const response = yield siadCall('/wallet/transactions?startheight=0&endheight=-1')
		const transactions = parseRawTransactions(response)
		yield put(actions.setTransactions(transactions))
	} catch (e) {
		console.error('error fetching transactions: ' + e.toString())
	}
}
// Call /wallet/address, set the receive address, and show the receive prompt.
function *getNewReceiveAddressSaga() {
	try {
		const response = yield siadCall('/wallet/address')
		yield put(actions.setReceiveAddress(response.address))
		yield put(actions.showReceivePrompt())
	} catch (e) {
		sendError(e)
	}
}

function *sendCurrencySaga(action) {
	try {
		if (action.currencytype === undefined || action.amount === undefined || action.destination === undefined || action.amount === '' || action.currencytype === '' || action.destination === '') {
			throw { message: 'You must specify an amount and a destination to send Siacoin!' }
		}
		if (action.currencytype !== 'siafunds' && action.currencytype !== 'siacoins') {
			throw { message: 'Invalid currency type!' }
		}
		const sendAmount = action.currencytype === 'siacoins' ? SiaAPI.siacoinsToHastings(action.amount).toString() : action.amount
		yield siadCall({
			url: '/wallet/' + action.currencytype,
			method: 'POST',
			qs: {
				destination: action.destination,
				amount: sendAmount,
			},
		})
		yield put(actions.closeSendPrompt())
		yield put(actions.getBalance())
		yield put(actions.getTransactions())
		yield put(actions.setSendAmount(''))
		yield put(actions.setSendAddress(''))
	} catch (e) {
		sendError(e)
	}
}

// getSyncState queries the API for the synchronization status of the node and
// sets the wallet's `synced` state.
function *getSyncStateSaga() {
	try {
		const response = yield siadCall('/consensus')
		yield put(actions.setSyncState(response.synced))
	} catch (e) {
		console.error('error fetching sync status: ' + e.toString())
	}
}

// These functions are run by the redux-saga middleware.
export function* watchCreateNewWallet() {
	yield *takeEvery(constants.CREATE_NEW_WALLET, createWalletSaga)
}
export function* watchGetLockStatus() {
	yield *takeEvery(constants.GET_LOCK_STATUS, getLockStatusSaga)
}
export function* watchUnlockWallet() {
	yield *takeEvery(constants.UNLOCK_WALLET, walletUnlockSaga)
}
export function* watchLockWallet() {
	yield *takeEvery(constants.LOCK_WALLET, walletLockSaga)
}
export function* watchGetBalance() {
	yield *takeEvery(constants.GET_BALANCE, getBalanceSaga)
}
export function* watchGetTransactions() {
	yield *takeEvery(constants.GET_TRANSACTIONS, getTransactionsSaga)
}
export function* watchGetNewReceiveAddress() {
	yield *takeEvery(constants.GET_NEW_RECEIVE_ADDRESS, getNewReceiveAddressSaga)
}
export function* watchSendCurrency() {
	yield *takeEvery(constants.SEND_CURRENCY, sendCurrencySaga)
}
export function* watchGetSyncState() {
	yield *takeEvery(constants.GET_SYNCSTATE, getSyncStateSaga)
}
