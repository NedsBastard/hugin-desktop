<script>
import {fade} from 'svelte/transition'
import ChatInput from '$lib/components/chat/ChatInput.svelte'
import {groupMessages} from '$lib/stores/groupmsgs.js'
import GroupMessage from '$lib/components/chat/GroupMessage.svelte'
import GroupList from '$lib/components/chat/GroupList.svelte'
import {groups, notify, user} from '$lib/stores/user.js'
import {onDestroy, onMount} from 'svelte'
import AddGroup from '$lib/components/chat/AddGroup.svelte'
import {page} from '$app/stores'
import InfiniteScroll from "svelte-infinite-scroll";
import BlockContact from '$lib/components/chat/BlockContact.svelte'
import { containsOnlyEmojis } from '$lib/utils/utils'

let boardMsgs = []
let replyto = ''
let reply_exit_icon = 'x'
let active
let replyColor
let nickname
let noMsgs = false
let filterBoards = []
let filterEmojis = []
let fixedGroups = []
let react = false
let unreadMsgs = []
let replyTrue = false
let chatWindow
let scrollGroups = []

onMount(async () => {
    chatWindow = document.getElementById('group_chat_window')
    console.log('mounting')

    let filter = $notify.unread.filter((a) => a.type !== 'group')
    $notify.unread = filter
    scrollDown()

    //Listens for new messages from backend
    window.api.receive('groupMsg', (data) => {
        if (data.address === $user.huginAddress.substring(0, 99)) return
        //*TODO*//Keep logs to experiment with toast popups

        if (data.group === $groups.thisGroup.key && $page.url.pathname === '/groups') {
            //Push new message to store
            printBoardMessage(data)
        } else {
            console.log('Another group', data)
        }
})

})

onDestroy(() => {
    window.api.removeAllListeners('groupMsg')
    window.api.removeAllListeners('sent_group')
})

window.api.receive('sent_group', (data) => {
    addHash(data)
})

//Send message to store and DB
function sendGroupMsg(e) {

    if (e.detail.text.length > 477) {
        $notify.errors.push({
            message: 'Message is too long',
            name: 'Error',
            hash: parseInt(Date.now()),
        })
        $notify.errors = $notify.errors
        return
    }
    let msg = e.detail.text
    let myaddr = $user.huginAddress.substring(0, 99)
    let time = Date.now()
    let myName = $user.username
    let group = thisGroup
    //Reaction switch
    if (e.detail.reply) {
        replyto = e.detail.reply
    }
    //Construct a new json object (myBoardMessage) to be able to print our message instant.
    let myGroupMessage = {
        message: msg,
        grp: group,
        reply: replyto,
        address: myaddr,
        time: time,
        name: myName,
        hash: time,
    }
    let sendMsg = {
        m: msg,
        g: group,
        r: replyto,
        k: myaddr,
        t: time,
        n: myName,
        hash: time,
    }
    window.api.sendGroupMessage(sendMsg)
    printBoardMessage(myGroupMessage)
    replyExit()
    scrollDown()
}

const scrollDown = () => {
    chatWindow.scrollTop = chatWindow.scrollHeight
}

//Prints any single board message. Takes boardmessage and updates to store.
const printBoardMessage = (groupMsg) => {
    if (
        groupMsg.reply.length === 64 &&
        groupMsg.message.length < 9 &&
        containsOnlyEmojis(groupMsg.message)
    ) {
        updateReactions(groupMsg)
    } else if (
        groupMsg.message.length > 0 &&
        !(groupMsg.reply.length === 64 && containsOnlyEmojis(groupMsg.message))
    ) {
        fixedGroups.unshift(groupMsg)
    }
    groupMessages.update((current) => {
        return [groupMsg, ...current]
    })
    fixedGroups = fixedGroups
}

//Reactive, updates thisGroup.
$: thisGroup = $groups.thisGroup.key

//Exit reply mode
const replyExit = () => {
    replyto = false
    groups.update((data) => {
        return {
            ...data,
            replyTo: { reply: false },
        }
    })
}

//Enter reply mode
async function replyToMessage(hash, nickname, emoji = false) {
    if (replyto != false) {
        await replyExit()
    }
    replyto = hash

    groups.update((data) => {
        return {
            ...data,
            replyTo: {
                to: hash,
                nick: nickname,
                reply: true,
                emoji: emoji,
            },
        }
    })
}

//Default value should be false to hide the AddBoard form.
let wantToAdd = false

//Open AddGroup component and update state in store.
const openAddGroup = () => {
    wantToAdd = !wantToAdd

    if (!wantToAdd) {
        groups.update((data) => {
            return {
                ...data,
                addGroup: false,
            }
        })
    }
}
//Adds new board to groArray and prints that board, its probably empty.
const addNewGroup = (e) => {
    let group = e.detail
    if (group.length < 32) return
    openAddGroup()
    let add = {
        m: 'Added group',
        n: group.name,
        hash: Date.now() * 2,
        t: Date.now().toString(),
        s: '',
        k: group.key,
        sent: false,
        r: '',
        g: group.key,
        h: parseInt(Date.now()),
    }
    window.api.addGroup(add)

    printGroup(group)
}

//Svelte reactive. Sets noMsgs boolean for welcome message.
$: if ($groupMessages.length == 0) {
    noMsgs = true
} else {
    noMsgs = false
}

//Checks messages for reactions in chosen board from printBoard() function
async function checkReactions() {
    //All boardmessages all messages except reactions
    filterBoards = await $groupMessages.filter(
        (m) => m.message.length > 0 && !(m.reply.length === 64 && containsOnlyEmojis(m.message))
    )
    //Only reactions
    filterEmojis = await $groupMessages.filter(
        (e) => e.reply.length === 64 && e.message.length < 9 && containsOnlyEmojis(e.message)
    )
    console.log('filter emoji ', filterEmojis)
    if (filterEmojis.length) {
        //Adding emojis to the correct message.
        await addEmoji()
    } else {
        fixedGroups = filterBoards
    }
}

//Print chosen board. SQL query to backend and then set result in Svelte store, then updates thisGroup.
async function printGroup(group) {
    console.log('Printing group', group)
    fixedGroups = []
    scrollGroups = []
    noMsgs = false
    groups.update((data) => {
        return {
            ...data,
            thisGroup: { key: group.key, name: group.name },
        }
    })
    //Load boardMessages from db
    await groupMessages.set(await window.api.printGroup(group.key))
    //Check for emojis and filter them
    await checkReactions()
    console.log($groups.groupArray)
    //Reactions should be set, update thisGroup in store and set reply to false.
    groups.update((data) => {
        return {
            ...data,
            replyTo: { reply: false },
        }
    })
    scrollDown()
}

async function updateReactions(msg) {

    fixedGroups.some(function (r) {
        if (r.hash == msg.reply && !r.react) {
            r.react = []
            msg.hash = msg.hash + Date.now().toString() + Math.floor(Math.random() * 1000).toString()
            r.react.push(msg)
        } else if (r.hash == msg.reply && r.react) {
            msg.hash = msg.hash + Date.now().toString() + Math.floor(Math.random() * 1000).toString()
            r.react.push(msg)
        }
    })
    fixedGroups = fixedGroups
}

async function addEmoji() {

    let emojis = filterEmojis
    //Check for replies and message hash that match and then adds reactions to the messages.
    filterBoards.forEach(async function (a) {
        emojis.forEach(function (b) {
            if (!a.react && b.reply == a.hash) {
                a.react = []
                b.hash = b.hash + Date.now().toString() + Math.floor(Math.random() * 1000).toString()
                a.react.push(b)
                emojis.pop(b)

            } else if (b.reply == a.hash) {
                b.hash = b.hash + Date.now().toString() + Math.floor(Math.random() * 1000).toString()
                a.react.push(b)
                emojis.pop(b)
            }
        })
        fixedGroups.push(a)
    })
    fixedGroups = fixedGroups
}

//Reactive depending on user.addBoard boolean, displays AddBoard component.
$: wantToAdd = $groups.addGroup

$: replyTrue = $groups.replyTo.reply

function addHash(data) {
    fixedGroups.slice(-10).some(function (a) {
        if (a.hash === data.time) {
            a.hash = data.hash
        }
    })

    fixedGroups = fixedGroups
}

    // let pageNum = 0;

    // let size = 20
    // $: console.log('scrollgroups', scrollGroups)
    // $: console.log('scroll', fixedGroups.splice(size * pageNum, size * (pageNum + 1) - 1))
    // $: {
    //     console.log('reacting to scroll?')
    //     scrollGroups = [
    //     ...scrollGroups,

    //     ...fixedGroups.splice(size * pageNum, size * (pageNum + 1) - 1),
    //     ];
    // }

    // function loadMoreMessages() {
    //     pageNum++
    //     console.log('want to load more')
    // }

</script>

{#if wantToAdd}
    <AddGroup on:click="{openAddGroup}" on:addGroup="{(e) => addNewGroup(e)}" />
{/if}

{#if $user.block}
    <BlockContact />
{/if}

<main in:fade="{{ duration: 350 }}">
    <GroupList
        on:printGroup="{(e) => printGroup(e.detail)}"
        on:removeGroup="{() => printGroup($groups.groupArray[0])}"
    />

    <div class="right_side" in:fade="{{ duration: 350 }}" out:fade="{{ duration: 100 }}">
        <div class="fade"></div>
        <div class="outer" id="group_chat_window">
            {#each fixedGroups as message, i (message.hash + i.toString())}
                <GroupMessage
                    on:reactTo="{(e) => sendGroupMsg(e)}"
                    on:replyTo="{(e) => replyToMessage(message.hash, message.name)}"
                    message="{message}"
                    reply="{message.reply}"
                    msg="{message.message}"
                    myMsg="{message.sent}"
                    group="{message.grp}"
                    nickname="{message.name}"
                    msgFrom="{message.address}"
                    timestamp="{message.time}"
                    hash="{message.hash}"
                />
            {/each}
            <!-- <InfiniteScroll reverse={true} threshold={20} on:loadMore={() => loadMoreMessages()} /> -->
        </div>
        {#if replyTrue}
            <div class="reply_to_exit" class:reply_to="{replyTrue}" on:click="{() => replyExit()}">
                {reply_exit_icon} Reply to {$groups.replyTo.nick}
            </div>
        {/if}
        <ChatInput on:message="{(e) => sendGroupMsg(e)}" />
    </div>
</main>

<style lang="scss">
h3 {
    font-size: 16px;
    color: white;
}

h1 {
    color: white;
    margin: 0;
}

main {
    display: flex;
    margin-left: 85px;
    margin-right: 85px;
    z-index: 3;
    height: 100vh;
}

#board_box {
    width: 350px;
    border-left: 1px solid var(--border-color);
    overflow: hidden;
}

p {
    font-size: 17px;
    color: white;
}

.reply_to_exit {
    width: 50px;
    padding-right: 5px;
    display: none;
}

.reply_to {
    display: inline-flex;
    font-size: 10px;
    font-family: 'Roboto Mono';
    font-weight: 100;
    position: absolute;
    left: 10%;
    justify-content: center;
    color: white;
    padding: 4px;
    width: fit-content;
    z-index: 9;
    cursor: pointer;
}

.left_side {
    display: flex;
    flex-direction: column;
    width: 100%;
}

.right_side {
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    position: relative;
    width: 100%;
}

.inner {
    display: flex;
    flex-direction: column;
    padding-top: 20px;
    width: 100%;
}

.outer {
    display: flex;
    flex-direction: column-reverse;
    overflow: auto;
    padding-bottom: 5px;

    &::-webkit-scrollbar {
        display: none;
    }
}

.fade {
    position: absolute;
    top: 0;
    width: 100%;
    height: 40px;
    background: linear-gradient(180deg, #121212, #12121200);
    z-index: 100;
}
</style>
