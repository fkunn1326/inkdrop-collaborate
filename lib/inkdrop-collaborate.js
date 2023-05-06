'use babel';

const activeBindings = [];

import { actions } from 'inkdrop'
import { clipboard } from 'electron'
import { app } from '@electron/remote'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { CodemirrorBinding } from 'y-codemirror'
import React, { useEffect, useCallback, useState } from 'react'
import { logger, useModal } from 'inkdrop'


// for macos
app.on('open-url', (e, url) => {
  handleInvited(url);
});

// for windows
app.on('second-instance', (event, commandLine, workingDirectory) => {
  commandLine.forEach(cmd => {
    if (/inkdrop:\/\//.test(cmd)) {
      handleInvited(cmd);
    }
  });
});

const handleInvited = async (url) => {
  if (url.split("//")[1].startsWith("collab")){
    if (await findTagWithName("collaborate") && await findTagWithName(`collaborate_id:${url.split("//")[1].replace("collab/", "")}`)) {
      return
    }

    const pastId = inkdrop.getActiveEditor().props.noteId;
    inkdrop.commands.dispatch(document.body, 'core:new-note')

    const onChangeId = async() => {
      if (pastId !== inkdrop.getActiveEditor().props.noteId) {
        const collabTag = await getTagId("collaborate")
        const collabIdTag = await getTagId(url.split("//")[1].replace("collab/", ""))

        inkdrop.store.dispatch(actions.editingNote.update({ tags: [collabTag, collabIdTag] }))
        inkdrop.store.dispatch(actions.editor.change(true))
        // collabrate(inkdrop.getActiveEditor())
        clearInterval(set_interval_id);
      }
    }
    const set_interval_id = setInterval(onChangeId, 50);

  }else{
    return
  }
}

const validIsShared = async (editor) => {
  const db = inkdrop.main.dataStore.getLocalDB()
  const currentEditor = editor
  const currentTags = (await db.notes.get(currentEditor.props.noteId)).tags

  let collaborateId = null;

  const currentTagNames = await Promise.all(currentTags.map(async (tagId) => {
    const name = (await db.tags.get(tagId)).name
    if (name.startsWith("collaborate_id")) {
      collaborateId = name
    }
    return name
  }))


  if (currentTagNames.includes("collaborate") && collaborateId) {
    return collaborateId
  }else{
    return false
  }
}

const CollaborateDialog = (props) => {
  const modal = useModal()
  const { Dialog, EditorDrawerActionButtonCopyNoteLink } = inkdrop.components.classes
  const [ isShared, setIsShared ] = useState(false)


  const toggle = useCallback(() => {
    modal.show()
  }, [])

  useEffect(() => {
    const sub = inkdrop.commands.add(document.body, {
      'inkdrop-collaborate:toggle': toggle
    })
    return () => sub.dispose()
  }, [toggle])

  validIsShared(inkdrop.getActiveEditor()).then(function(value) {
    setIsShared(value)
  })

  return (
    <Dialog {...modal.state} onBackdropClick={modal.close}>
      <Dialog.Title icon="share">Share Note with Other user</Dialog.Title>
      {isShared ?
        <>
          <Dialog.Content>
            Invite link:
            <p style={{marginTop: "1em"}}>
              <button class="ui circular icon basic button" data-tooltip="Copy URL" data-inverted="" onClick={() => {
                clipboard.writeText(`inkdrop://collab/${isShared}`)
              }}>
                <i class="linkify icon" />
              </button>
              <a class="public-link" href={`inkdrop://collab/${isShared}`}>
                {`inkdrop://collab/${isShared}`}
              </a>
            </p>
          </Dialog.Content>
          <Dialog.Actions>
            <button className="ui button" onClick={modal.close}>
              Cancel
            </button>
            <button className="ui button primary" onClick={() => {
              inkdrop.commands.dispatch(document.body, 'inkdrop-collaborate:toggle-collaborate')
              modal.close()
            }}>
              Stop Shareing Invite Link
            </button>
          </Dialog.Actions>
        </>
        :
        <>
          <Dialog.Content>Are you sure you want to share this note with other user? An invite link will be created.</Dialog.Content>
          <Dialog.Actions>
            <button className="ui button" onClick={modal.close}>
              Close
            </button>
            <button className="ui button primary"  onClick={() => {
              inkdrop.commands.dispatch(document.body, 'inkdrop-collaborate:toggle-collaborate')
              modal.close()
            }}>
              Share
            </button>
          </Dialog.Actions>
        </>
      }
    </Dialog>
  )
}

const CollabrateEditorDrawerItem = () => {
  const { EditorDrawerItem, EditorDrawerSeparator } = inkdrop.components.classes

  return (
    <>
      <EditorDrawerSeparator />
      <EditorDrawerItem className="clickable" icon="share" onClick={() => {
        inkdrop.commands.dispatch(document.body, 'inkdrop-collaborate:toggle')
      }}>
        Collabrate
      </EditorDrawerItem>
    </>
  )
}

const findTagWithName = async (tagName) => {
  const db = inkdrop.main.dataStore.getLocalDB()
  const tagArr = (await db.tags.all()).filter((tag) => { if (tag.name === tagName) return tag })
  if (tagArr.length >= 1) {
    return tagArr[0]
  }
  return null;
}

const getTagId = async (tagName) => {
  const db = inkdrop.main.dataStore.getLocalDB()
  if (!await findTagWithName(tagName)) {
    const tagId = db.tags.createId(tagName)
    await db.tags.put({
      _id: tagId,
      name: tagName,
      count: 0,
      updatedAt: 0,
      createdAt: 0
    })
    return tagId
  }
  return (await findTagWithName(tagName))._id
}

const collabrate = async (editor) => {
  const db = inkdrop.main.dataStore.getLocalDB()
  const currentEditor = editor
  const currentTags = (await db.notes.get(currentEditor.props.noteId)).tags

  let collaborateId = null;

  const currentTagNames = await Promise.all(currentTags.map(async (tagId) => {
    const name = (await db.tags.get(tagId)).name
    if (name.startsWith("collaborate_id")) {
      collaborateId = name
    }
    return name
  }))

  if (currentTagNames.includes("collaborate") && collaborateId) {
    const ydoc = new Y.Doc()
    const provider = new WebsocketProvider('wss://y-websocket-kl49.onrender.com/', collaborateId, ydoc)
    const yText = ydoc.getText('codemirror')

    if (activeBindings.length > 0) {
      activeBindings.forEach((binding) => {
        binding.destroy()
        activeBindings.pop(binding)
      })
    }

    const binding = new CodemirrorBinding(yText, editor.cm, provider.awareness)
    activeBindings.push(binding)

    const account = await inkdrop.main.account.accountStore.load()
    binding.awareness.setLocalStateField('user', { color: `#${account.userId.slice(0, 6)}`, name: `${account.firstName} ${account.lastName}` })
  } else {
    return
  }
}

module.exports = {
  activate() {
    this.subscription = inkdrop.commands.add(document.body, {
      'inkdrop-collaborate:toggle-collaborate': async () => {
        const db = inkdrop.main.dataStore.getLocalDB()
        const currentEditor = inkdrop.getActiveEditor()
        const currentTags = (await db.notes.get(currentEditor.props.noteId)).tags

        const currentTagNames = await Promise.all(currentTags.map(async (tagId) => {
          const name = (await db.tags.get(tagId)).name
          if (name.startsWith("collaborate_id")) {
            return "collaborate_id"
          }
          return name
        }))

        if (currentTagNames.includes("collaborate") && currentTagNames.includes("collaborate_id")) {
          currentTags.pop(currentTags[currentTagNames.indexOf("collaborate")])
          currentTags.pop(currentTags[currentTagNames.indexOf("collaborate_id")])
          inkdrop.store.dispatch(actions.editingNote.update({ tags: currentTags }))
          inkdrop.store.dispatch(actions.editor.change(true))
          return;
        }

        const collabTag = await getTagId("collaborate")
        const collabIdTag = await getTagId(`collaborate_id:${inkdrop.main.account._userId}/${currentEditor.props.noteId}`)

        inkdrop.store.dispatch(actions.editingNote.update({ tags: Array.from(new Set([...currentTags, collabTag, collabIdTag])) }))
        inkdrop.store.dispatch(actions.editor.change(true))
      }
    });

    inkdrop.onEditorLoad((editor) => {
      inkdrop.components.registerClass(CollabrateEditorDrawerItem)
      inkdrop.layouts.addComponentToLayout(
        'editor-drawer-menu',
        'CollabrateEditorDrawerItem'
      )
      inkdrop.components.registerClass(CollaborateDialog);
      inkdrop.layouts.addComponentToLayout(
        'modal',
        'CollaborateDialog'
      )

      collabrate(editor)
      inkdrop.commands.add(document.body, {
        'core:open-note': () => {
          if (activeBindings.length > 0) {
            activeBindings.forEach((binding) => {
              binding.destroy()
              activeBindings.pop(binding)
            })
          }

          const pastId = inkdrop.getActiveEditor().props.noteId;

          // この時点ではまだactiveeditorが切り替わっていないのでsetinterval
          const onChangeId = () => {
            if (pastId !== inkdrop.getActiveEditor().props.noteId) {
              collabrate(inkdrop.getActiveEditor())
              clearInterval(set_interval_id);
            }
          }
          const set_interval_id = setInterval(onChangeId, 50);
        }
      })
    })
  },

  deactivate() {
    inkdrop.layouts.removeComponentFromLayout(
      'editor-drawer-menu',
      'CollabrateEditorDrawerItem'
    )
    inkdrop.components.deleteClass(CollabrateEditorDrawerItem)
    inkdrop.layouts.removeComponentFromLayout(
      'modal',
      'CollaborateDialog'
    )
    inkdrop.components.deleteClass(CollaborateDialog);
  }

};