'use client'

import { ViewType } from '@/components/auth'
import { AuthDialog } from '@/components/auth-dialog'
import { Chat } from '@/components/chat'
import { ChatInput } from '@/components/chat-input'
import { ChatPicker } from '@/components/chat-picker'
import { ChatSettings } from '@/components/chat-settings'
import { AttachedContextPanel } from '@/components/attached-context-panel'
import { NavBar } from '@/components/navbar'
import { Preview } from '@/components/preview'
import { CodeSelection, CodeSelectionMeta } from '@/components/code-view'
import { SelectionContextMenu } from '@/components/selection-context-menu'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { useAuth } from '@/lib/auth'
import { Message, toAISDKMessages, toMessageImage } from '@/lib/messages'
import { LLMModelConfig } from '@/lib/models'
import modelsList from '@/lib/models.json'
import { FragmentSchema, fragmentSchema as schema } from '@/lib/schema'
import { supabase } from '@/lib/supabase'
import templates from '@/lib/templates'
import { ExecutionResult } from '@/lib/types'
import { DeepPartial } from 'ai'
import { experimental_useObject as useObject } from 'ai/react'
import { usePostHog } from 'posthog-js/react'
import { SetStateAction, useEffect, useState } from 'react'
import { useLocalStorage } from 'usehooks-ts'

export default function Home() {
  const MAX_SELECTION_LENGTH = 12000
  const [chatInput, setChatInput] = useLocalStorage('chat', '')
  const [files, setFiles] = useState<File[]>([])
  const [selectedTemplate, setSelectedTemplate] = useState<string>(
    'auto',
  )
  const [languageModel, setLanguageModel] = useLocalStorage<LLMModelConfig>(
    'languageModel',
    {
      model: 'claude-sonnet-4-20250514',
    },
  )

  const posthog = usePostHog()

  const [result, setResult] = useState<ExecutionResult>()
  const [messages, setMessages] = useState<Message[]>([])
  const [fragment, setFragment] = useState<DeepPartial<FragmentSchema>>()
  const [currentTab, setCurrentTab] = useState<'code' | 'fragment'>('code')
  const [isPreviewLoading, setIsPreviewLoading] = useState(false)
  const [isAuthDialogOpen, setAuthDialog] = useState(false)
  const [authView, setAuthView] = useState<ViewType>('sign_in')
  const [isRateLimited, setIsRateLimited] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [selectedCode, setSelectedCode] = useState<string | null>(null)
  const [selectionMeta, setSelectionMeta] = useState<CodeSelectionMeta | null>(
    null,
  )
  const [selectionError, setSelectionError] = useState<string | null>(null)
  const [clearSelectionSignal, setClearSelectionSignal] = useState(0)
  const [pendingSelection, setPendingSelection] = useState<CodeSelection | null>(
    null,
  )
  const [selectionMenuPosition, setSelectionMenuPosition] = useState<
    { left: number; top: number } | null
  >(null)
  const [autoAttachSelection, setAutoAttachSelection] = useLocalStorage(
    'autoAttachSelection',
    false,
  )
  const { session, userTeam } = useAuth(setAuthDialog, setAuthView)
  const [useMorphApply, setUseMorphApply] = useLocalStorage(
    'useMorphApply',
    process.env.NEXT_PUBLIC_USE_MORPH_APPLY === 'true',
  )

  const filteredModels = modelsList.models.filter((model) => {
    if (process.env.NEXT_PUBLIC_HIDE_LOCAL_MODELS) {
      return model.providerId !== 'ollama'
    }
    return true
  })

  const defaultModel = filteredModels.find(
    (model) => model.id === 'claude-sonnet-4-20250514',
  ) || filteredModels[0]

  const currentModel = filteredModels.find(
    (model) => model.id === languageModel.model,
  ) || defaultModel

  // Update localStorage if stored model no longer exists
  useEffect(() => {
    if (languageModel.model && !filteredModels.find((m) => m.id === languageModel.model)) {
      setLanguageModel({ ...languageModel, model: defaultModel.id })
    }
  }, [languageModel.model])
  const currentTemplate =
    selectedTemplate === 'auto'
      ? templates
      : { [selectedTemplate]: templates[selectedTemplate] }
  const lastMessage = messages[messages.length - 1]

  // Determine which API to use based on morph toggle and existing fragment
  const shouldUseMorph =
    useMorphApply && fragment && fragment.code && fragment.file_path
  const apiEndpoint = shouldUseMorph ? '/api/morph-chat' : '/api/chat'

  const { object, submit, isLoading, stop, error } = useObject({
    api: apiEndpoint,
    schema,
    onError: (error) => {
      console.error('Error submitting request:', error)
      if (error.message.includes('limit')) {
        setIsRateLimited(true)
      }

      setErrorMessage(error.message)
    },
    onFinish: async ({ object: fragment, error }) => {
      if (!error) {
        // send it to /api/sandbox
        console.log('fragment', fragment)
        setIsPreviewLoading(true)
        posthog.capture('fragment_generated', {
          template: fragment?.template,
        })

        const response = await fetch('/api/sandbox', {
          method: 'POST',
          body: JSON.stringify({
            fragment,
            userID: session?.user?.id,
            teamID: userTeam?.id,
            accessToken: session?.access_token,
          }),
        })

        const result = await response.json()
        console.log('result', result)
        posthog.capture('sandbox_created', { url: result.url })

        setResult(result)
        setCurrentPreview({ fragment, result })
        setMessage({ result })
        setCurrentTab('fragment')
        setIsPreviewLoading(false)
      }
    },
  })

  useEffect(() => {
    if (object) {
      setFragment(object)
      const content: Message['content'] = [
        { type: 'text', text: object.commentary || '' },
        { type: 'code', text: object.code || '' },
      ]

      if (!lastMessage || lastMessage.role !== 'assistant') {
        addMessage({
          role: 'assistant',
          content,
          object,
        })
      }

      if (lastMessage && lastMessage.role === 'assistant') {
        setMessage({
          content,
          object,
        })
      }
    }
  }, [object])

  useEffect(() => {
    if (error) stop()
  }, [error])

  const attachSelection = (selection: CodeSelection) => {
    const trimmed = selection.code.trim()
    if (!trimmed) return

    if (trimmed.length > MAX_SELECTION_LENGTH) {
      setSelectionError(
        `Selection too large (max ${MAX_SELECTION_LENGTH.toLocaleString()} chars)`,
      )
      return
    }

    setSelectionError(null)
    setSelectedCode(trimmed)
    setSelectionMeta(selection.meta ?? null)
    setPendingSelection(null)
    setSelectionMenuPosition(null)
  }

  const handleCodeSelection = (selection: CodeSelection | null) => {
    if (!selection || !selection.code.trim()) return

    const normalized: CodeSelection = {
      ...selection,
      code: selection.code.trim(),
    }

    if (autoAttachSelection) {
      attachSelection(normalized)
      return
    }

    setSelectionError(null)
    setPendingSelection(normalized)
    if (normalized.rect) {
      setSelectionMenuPosition({
        left: normalized.rect.left,
        top: normalized.rect.bottom + 8,
      })
    }
  }

  const clearAttachedContext = () => {
    setSelectedCode(null)
    setSelectionMeta(null)
    setSelectionError(null)
    setClearSelectionSignal((tick) => tick + 1)
    setPendingSelection(null)
    setSelectionMenuPosition(null)
    clearBrowserSelection()
  }

  function setMessage(message: Partial<Message>, index?: number) {
    setMessages((previousMessages) => {
      const updatedMessages = [...previousMessages]
      updatedMessages[index ?? previousMessages.length - 1] = {
        ...previousMessages[index ?? previousMessages.length - 1],
        ...message,
      }

      return updatedMessages
    })
  }

  function buildMessagesWithContext(base: Message[]) {
    if (!selectedCode) return base

    const linesText = selectionMeta?.startLine && selectionMeta?.endLine
      ? ` (lines ${selectionMeta.startLine}-${selectionMeta.endLine})`
      : ''

    return [
      ...base,
      {
        role: 'user' as const,
        content: [
          {
            type: 'text' as const,
            text: `Attached context${linesText}:\n${selectedCode}`,
          },
        ],
      },
    ]
  }

  const dismissPendingSelection = () => {
    setPendingSelection(null)
    setSelectionMenuPosition(null)
    setClearSelectionSignal((tick) => tick + 1)
    clearBrowserSelection()
  }

  function clearBrowserSelection() {
    if (typeof window !== 'undefined') {
      const selection = window.getSelection()
      if (selection?.empty) {
        selection.empty()
      } else if (selection?.removeAllRanges) {
        selection.removeAllRanges()
      }
    }
  }

  async function handleSubmitAuth(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()

    if (!session) {
      return setAuthDialog(true)
    }

    if (isLoading) {
      stop()
    }

    const content: Message['content'] = [{ type: 'text', text: chatInput }]
    const images = await toMessageImage(files)

    if (images.length > 0) {
      images.forEach((image) => {
        content.push({ type: 'image', image })
      })
    }

    const updatedMessages = addMessage({
      role: 'user',
      content,
    })

    const messagesWithContext = buildMessagesWithContext(updatedMessages)

    submit({
      userID: session?.user?.id,
      teamID: userTeam?.id,
      messages: toAISDKMessages(messagesWithContext),
      template: currentTemplate,
      model: currentModel,
      config: languageModel,
      context: selectedCode,
      contextMeta: selectionMeta,
      ...(shouldUseMorph && fragment ? { currentFragment: fragment } : {}),
    })

    setChatInput('')
    setFiles([])
    setCurrentTab('code')

    posthog.capture('chat_submit', {
      template: selectedTemplate,
      model: languageModel.model,
    })
  }

  function retry() {
    const messagesWithContext = buildMessagesWithContext(messages)
    submit({
      userID: session?.user?.id,
      teamID: userTeam?.id,
      messages: toAISDKMessages(messagesWithContext),
      template: currentTemplate,
      model: currentModel,
      config: languageModel,
      context: selectedCode,
      contextMeta: selectionMeta,
      ...(shouldUseMorph && fragment ? { currentFragment: fragment } : {}),
    })
  }

  function addMessage(message: Message) {
    setMessages((previousMessages) => [...previousMessages, message])
    return [...messages, message]
  }

  function handleSaveInputChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setChatInput(e.target.value)
  }

  function handleFileChange(change: SetStateAction<File[]>) {
    setFiles(change)
  }

  function logout() {
    supabase
      ? supabase.auth.signOut()
      : console.warn('Supabase is not initialized')
  }

  function handleLanguageModelChange(e: LLMModelConfig) {
    setLanguageModel({ ...languageModel, ...e })
  }

  function handleSocialClick(target: 'github' | 'x' | 'discord') {
    if (target === 'github') {
      window.open('https://github.com/e2b-dev/fragments', '_blank')
    } else if (target === 'x') {
      window.open('https://x.com/e2b', '_blank')
    } else if (target === 'discord') {
      window.open('https://discord.gg/e2b', '_blank')
    }

    posthog.capture(`${target}_click`)
  }

  function handleClearChat() {
    stop()
    setChatInput('')
    setFiles([])
    setMessages([])
    setFragment(undefined)
    setResult(undefined)
    setCurrentTab('code')
    setIsPreviewLoading(false)
    clearAttachedContext()
  }

  function setCurrentPreview(preview: {
    fragment: DeepPartial<FragmentSchema> | undefined
    result: ExecutionResult | undefined
  }) {
    setFragment(preview.fragment)
    setResult(preview.result)
  }

  function handleUndo() {
    setMessages((previousMessages) => [...previousMessages.slice(0, -2)])
    setCurrentPreview({ fragment: undefined, result: undefined })
  }

  return (
    <main className="flex min-h-screen max-h-screen">
      {supabase && (
        <AuthDialog
          open={isAuthDialogOpen}
          setOpen={setAuthDialog}
          view={authView}
          supabase={supabase}
        />
      )}
      <div className="grid w-full md:grid-cols-2">
        <div
          className={`flex flex-col w-full max-h-full max-w-[800px] mx-auto px-4 overflow-auto ${fragment ? 'col-span-1' : 'col-span-2'}`}
        >
          <NavBar
            session={session}
            showLogin={() => setAuthDialog(true)}
            signOut={logout}
            onSocialClick={handleSocialClick}
            onClear={handleClearChat}
            canClear={messages.length > 0}
            canUndo={messages.length > 1 && !isLoading}
            onUndo={handleUndo}
          />
          <Chat
            messages={messages}
            isLoading={isLoading}
            setCurrentPreview={setCurrentPreview}
          />
          {selectionError && (
            <Alert variant="destructive" className="mx-4 mb-2">
              <AlertTitle>Selection too large</AlertTitle>
              <AlertDescription>{selectionError}</AlertDescription>
            </Alert>
          )}
          {!autoAttachSelection && pendingSelection && (
            <SelectionContextMenu
              text={pendingSelection.code}
              position={
                selectionMenuPosition || {
                  left: 24,
                  top: 120,
                }
              }
              onAttach={() => attachSelection(pendingSelection)}
              onClear={dismissPendingSelection}
            />
          )}
          {selectedCode && (
            <AttachedContextPanel
              code={selectedCode}
              meta={selectionMeta}
              onClear={clearAttachedContext}
            />
          )}
          <ChatInput
            retry={retry}
            isErrored={error !== undefined}
            errorMessage={errorMessage}
            isLoading={isLoading}
            isRateLimited={isRateLimited}
            stop={stop}
            input={chatInput}
            handleInputChange={handleSaveInputChange}
            handleSubmit={handleSubmitAuth}
            isMultiModal={currentModel?.multiModal || false}
            files={files}
            handleFileChange={handleFileChange}
          >
            <ChatPicker
              templates={templates}
              selectedTemplate={selectedTemplate}
              onSelectedTemplateChange={setSelectedTemplate}
              models={filteredModels}
              languageModel={languageModel}
              onLanguageModelChange={handleLanguageModelChange}
            />
            <ChatSettings
              languageModel={languageModel}
              onLanguageModelChange={handleLanguageModelChange}
              apiKeyConfigurable={!process.env.NEXT_PUBLIC_NO_API_KEY_INPUT}
              baseURLConfigurable={!process.env.NEXT_PUBLIC_NO_BASE_URL_INPUT}
              useMorphApply={useMorphApply}
              onUseMorphApplyChange={setUseMorphApply}
              autoAttachSelection={autoAttachSelection}
              onAutoAttachSelectionChange={setAutoAttachSelection}
            />
          </ChatInput>
        </div>
        <Preview
          teamID={userTeam?.id}
          accessToken={session?.access_token}
          selectedTab={currentTab}
          onSelectedTabChange={setCurrentTab}
          isChatLoading={isLoading}
          isPreviewLoading={isPreviewLoading}
          fragment={fragment}
          result={result as ExecutionResult}
          onClose={() => setFragment(undefined)}
          onCodeSelection={handleCodeSelection}
          clearSelectionSignal={clearSelectionSignal}
          selectionInteractionMode={autoAttachSelection ? 'auto' : 'menu'}
        />
      </div>
    </main>
  )
}
