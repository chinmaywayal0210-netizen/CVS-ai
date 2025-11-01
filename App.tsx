import React, { useState, useRef, useEffect, useCallback } from 'react';
import { GoogleGenAI, Content, Modality } from '@google/genai';
import { Message, MessageRole, Conversation } from './types';
import {
  UserIcon,
  BotIcon,
  SendIcon,
  PlusIcon,
  MenuIcon,
  SunIcon,
  MoonIcon,
  TrashIcon,
  StopIcon,
  MicrophoneIcon,
  SummarizeIcon,
  XIcon,
  SpeakerOnIcon,
  SpeakerOffIcon,
  CopyIcon,
  ExportIcon,
  CheckIcon,
  BrandIcon,
  PaperclipIcon,
  SystemThemeIcon,
} from './components/icons';

declare var marked: any;
declare var hljs: any;
// @ts-ignore
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

const API_KEY = process.env.API_KEY;
const LOADING_INDICATOR_CONTENT = '___LOADING___';

const promptSuggestions = [
    { title: 'Plan a trip', prompt: 'Plan a 3-day trip to Tokyo for a solo traveler on a budget' },
    { title: 'Write a poem', prompt: 'Write a short poem about the sound of a city at night' },
    { title: 'Explain a concept', prompt: 'Explain quantum computing in simple, accessible terms' },
    { title: 'Help me debug', prompt: 'I have a Python function that is not sorting a list correctly. Here is the code: ...' }
];

const App: React.FC = () => {
  const [conversations, setConversations] = useState<Record<string, Conversation>>({});
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const [userInput, setUserInput] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [theme, setTheme] = useState<'light' | 'dark' | 'system'>('system');
  const [isSidebarOpen, setSidebarOpen] = useState(false);
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [isSummaryModalOpen, setIsSummaryModalOpen] = useState<boolean>(false);
  const [summaryContent, setSummaryContent] = useState<string>('');
  const [isSummarizing, setIsSummarizing] = useState<boolean>(false);
  const [isTtsEnabled, setIsTtsEnabled] = useState<boolean>(false);
  const [copiedMessageIndex, setCopiedMessageIndex] = useState<number | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);

  const isStoppedRef = useRef<boolean>(false);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const recognitionRef = useRef<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Setup Speech Recognition
  useEffect(() => {
    if (!SpeechRecognition) {
      console.warn("Speech recognition not supported in this browser.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.lang = 'en-US';
    recognition.interimResults = false;

    recognition.onstart = () => setIsRecording(true);
    recognition.onend = () => setIsRecording(false);

    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      setUserInput(transcript);
      setTimeout(() => submitMessage(transcript), 100);
    };

    recognition.onerror = (event: any) => {
      console.error('Speech recognition error:', event.error);
      let errorMessage = 'An unknown speech recognition error occurred.';
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        errorMessage = "Microphone permission denied. Please allow microphone access in your browser settings.";
      } else if (event.error === 'no-speech') {
        errorMessage = "No speech was detected. Please try again.";
      }
      addMessageToCurrentChat({ role: MessageRole.ERROR, content: errorMessage });
    };

    recognitionRef.current = recognition;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentChatId]); // Depend on chatId to re-scope addMessageToCurrentChat
  
  // Load state from localStorage on initial render
  useEffect(() => {
    try {
      const savedConversations = localStorage.getItem('aiChatConversations');
      const savedChatId = localStorage.getItem('aiChatCurrentId');
      const savedTheme = localStorage.getItem('aiChatTheme');
      const savedTts = localStorage.getItem('aiChatTtsEnabled');

      const loadedConversations = savedConversations ? JSON.parse(savedConversations) : {};
      setConversations(loadedConversations);

      if (savedChatId && loadedConversations[savedChatId]) {
        setCurrentChatId(savedChatId);
      } else if (Object.keys(loadedConversations).length > 0) {
        setCurrentChatId(Object.keys(loadedConversations).sort((a, b) => parseInt(b.split('_')[1]) - parseInt(a.split('_')[1]))[0]);
      } else {
        startNewChat();
      }

      if (savedTheme === 'light' || savedTheme === 'dark' || savedTheme === 'system') {
        setTheme(savedTheme as 'light' | 'dark' | 'system');
      }
      setIsTtsEnabled(savedTts === 'true');

    } catch (error) {
      console.error("Failed to load state from localStorage", error);
      startNewChat();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Save state to localStorage whenever it changes
  useEffect(() => {
    try {
      // Create a copy of conversations without image data to avoid storage quota issues
      const conversationsToSave = JSON.parse(JSON.stringify(conversations));
      for (const id in conversationsToSave) {
          if (conversationsToSave[id].messages) {
            conversationsToSave[id].messages.forEach((msg: Message) => {
                delete msg.imageUrl;
            });
          }
      }
      localStorage.setItem('aiChatConversations', JSON.stringify(conversationsToSave));

      if (currentChatId) {
        localStorage.setItem('aiChatCurrentId', currentChatId);
      }
      localStorage.setItem('aiChatTheme', theme);
      localStorage.setItem('aiChatTtsEnabled', String(isTtsEnabled));
    } catch (error) {
      console.error("Failed to save state to localStorage", error);
    }
  }, [conversations, currentChatId, theme, isTtsEnabled]);

  useEffect(() => {
    const applyTheme = () => {
      if (theme === 'system') {
        if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
          document.documentElement.classList.add('dark');
        } else {
          document.documentElement.classList.remove('dark');
        }
      } else if (theme === 'dark') {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    };

    applyTheme();

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    mediaQuery.addEventListener('change', applyTheme);

    return () => {
      mediaQuery.removeEventListener('change', applyTheme);
    };
  }, [theme]);

  // Auto-scroll chat container
  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [conversations[currentChatId || '']?.messages, isLoading]);

  // Highlight code blocks and style tables
  useEffect(() => {
    document.querySelectorAll('pre code').forEach((block) => {
      hljs.highlightElement(block as HTMLElement);
    });

    // Wrap tables for horizontal scrolling on small screens
    document.querySelectorAll('.markdown-content table').forEach(table => {
      if (table.parentElement?.classList.contains('table-wrapper')) {
        return;
      }
      const wrapper = document.createElement('div');
      wrapper.className = 'table-wrapper';
      table.parentNode?.insertBefore(wrapper, table);
      wrapper.appendChild(table);
    });
  }, [conversations[currentChatId || '']?.messages, isLoading, summaryContent]);

  // Update browser tab title
  useEffect(() => {
    const currentTitle = conversations[currentChatId || '']?.title;
    if (currentTitle && currentTitle !== 'New Chat') {
        document.title = `${currentTitle} | CVS.ai`;
    } else {
        document.title = 'CVS.ai';
    }
  }, [currentChatId, conversations]);
  
  const speak = useCallback((text: string) => {
    if (!text || typeof window === 'undefined' || !window.speechSynthesis) {
        return;
    }

    // Strip markdown for cleaner speech
    const plainText = (() => {
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = marked.parse(text, { breaks: true, gfm: true });
        // Announce code blocks instead of reading them
        tempDiv.querySelectorAll('pre').forEach(pre => {
            const codeEl = pre.querySelector('code');
            const lang = codeEl?.className.replace('language-', '') || 'code';
            pre.textContent = ` A ${lang} code block follows. `;
        });
        return tempDiv.textContent || tempDiv.innerText || '';
    })();
    
    const utterance = new SpeechSynthesisUtterance(plainText);
    speechSynthesis.cancel(); // Stop any previous speech
    speechSynthesis.speak(utterance);
}, []);

 const autoSpeak = useCallback((text: string) => {
    if (isTtsEnabled) {
      speak(text);
    }
 }, [isTtsEnabled, speak]);
  
  const addMessageToCurrentChat = useCallback((message: Message) => {
    if (!currentChatId) return;
    setConversations(prev => {
      const updatedConversations = { ...prev };
      const current = updatedConversations[currentChatId];
      if (current) {
        current.messages.push(message);
      }
      return updatedConversations;
    });
  }, [currentChatId]);

  const updateLastMessage = (contentChunk: string, isDone: boolean) => {
     if (!currentChatId) return;
     setConversations(prev => {
       const updatedConversations = { ...prev };
       const current = updatedConversations[currentChatId];
       if (!current) return prev;

       const messages = current.messages;
       const lastMessage = messages[messages.length - 1];
       if (lastMessage && lastMessage.role === MessageRole.MODEL) {
         let currentContent = lastMessage.content;
         if (currentContent === LOADING_INDICATOR_CONTENT) {
            currentContent = '';
         } else if (currentContent.endsWith('▋')) {
            currentContent = currentContent.slice(0, -1);
         }
         
         lastMessage.content = currentContent + contentChunk + (isDone ? '' : '▋');
       }
       return updatedConversations;
     });
   };

  const getChatTitle = useCallback(async (firstMessage: string) => {
    if (!API_KEY) return "New Chat";
    try {
      const ai = new GoogleGenAI({ apiKey: API_KEY });
      const prompt = `Generate a very short, 3-4 word topic for the following user question. Just return the topic, nothing else.\n\nQuestion: "${firstMessage}"`;
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
      });
      return response.text.replace(/["']/g, "").trim() || "New Chat";
    } catch (error) {
      console.error("Error generating title:", error);
      return "New Chat";
    }
  }, []);

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => {
            const result = (reader.result as string).split(',')[1];
            resolve(result);
        };
        reader.onerror = (error) => reject(error);
    });
  };

  const submitMessage = async (messageContent: string) => {
    if ((!messageContent.trim() && !imageFile) || isLoading || !currentChatId) return;

    const localChatId = currentChatId;
    const localImageFile = imageFile;
    const localImagePreview = imagePreview;

    setUserInput('');
    setImageFile(null);
    setImagePreview(null);
    
    const isFirstMessage = conversations[localChatId].messages.length === 0;

    speechSynthesis.cancel();
    isStoppedRef.current = false;
    
    const userMessage: Message = { 
        role: MessageRole.USER, 
        content: messageContent,
        imageUrl: localImagePreview ?? undefined,
    };

    setConversations(prev => {
        const updatedConversations = { ...prev };
        const current = updatedConversations[localChatId];
        if (current) {
            current.messages.push(userMessage);
            current.messages.push({ role: MessageRole.MODEL, content: LOADING_INDICATOR_CONTENT });
        }
        return updatedConversations;
    });

    setIsLoading(true);

    if (isFirstMessage && userMessage.content && !userMessage.content.trim().startsWith('/generate')) {
        getChatTitle(userMessage.content).then(newTitle => {
            setConversations(prev => {
                if (prev[localChatId]) {
                    return { ...prev, [localChatId]: { ...prev[localChatId], title: newTitle } };
                }
                return prev;
            });
        });
    }

    try {
        if (!API_KEY) throw new Error("API_KEY environment variable not set.");
        const ai = new GoogleGenAI({ apiKey: API_KEY });

        // --- IMAGE GENERATION LOGIC ---
        if (messageContent.trim().startsWith('/generate ')) {
            const prompt = messageContent.substring('/generate '.length).trim();

            if (!prompt) {
                throw new Error("Please provide a prompt for image generation.");
            }
            
            const response = await ai.models.generateImages({
                model: 'imagen-4.0-generate-001',
                prompt: prompt,
                config: {
                    numberOfImages: 1,
                    outputMimeType: 'image/jpeg',
                },
            });
            
            const base64ImageBytes = response.generatedImages[0].image.imageBytes;
            const imageUrl = `data:image/jpeg;base64,${base64ImageBytes}`;

            const modelMessage: Message = {
                role: MessageRole.MODEL,
                content: `> ${prompt}`, // Use markdown blockquote for the prompt
                imageUrl: imageUrl,
            };

            setConversations(prev => {
                const updated = { ...prev };
                const current = updated[localChatId];
                if (current) {
                    current.messages.pop(); // Remove loading indicator
                    current.messages.push(modelMessage);
                }
                return updated;
            });


        // --- MULTIMODAL (IMAGE UPLOAD) LOGIC ---
        } else if (localImageFile) {
            const base64Data = await fileToBase64(localImageFile);
            
            const imagePart = {
                inlineData: {
                    mimeType: localImageFile.type,
                    data: base64Data,
                },
            };
            const textPart = { text: messageContent };
            const parts = messageContent ? [imagePart, textPart] : [imagePart];

            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash-image',
                contents: { parts: parts },
                config: { responseModalities: [Modality.IMAGE] },
            });

            let responseText = '';
            let responseImageUrl: string | undefined;

            if (response.candidates && response.candidates.length > 0) {
                for (const part of response.candidates[0].content.parts) {
                    if (part.text) {
                        responseText += part.text;
                    } else if (part.inlineData) {
                        responseImageUrl = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
                    }
                }
            } else {
                 responseText = response.text || 'An unexpected error occurred.';
            }

            const modelMessage: Message = {
                role: MessageRole.MODEL,
                content: responseText || (responseImageUrl ? '' : 'Image processed successfully.'),
                imageUrl: responseImageUrl,
            };
            
            setConversations(prev => {
                const updated = { ...prev };
                const current = updated[localChatId];
                if (current) {
                    current.messages.pop(); // Remove loading indicator
                    current.messages.push(modelMessage);
                }
                return updated;
            });
            autoSpeak(modelMessage.content);

        // --- TEXT-ONLY (STREAMING) LOGIC ---
        } else {
            const chatHistory = conversations[localChatId].messages
                .filter(m => m.role !== MessageRole.ERROR && !m.imageUrl) // Exclude image messages from text history
                .slice(0, -2) // Exclude user message and loading indicator
                .map(m => ({
                    role: m.role,
                    parts: [{ text: m.content }]
                })) as Content[];
            
            const chat = ai.chats.create({ model: 'gemini-flash-lite-latest', history: chatHistory });
            const stream = await chat.sendMessageStream({ message: userMessage.content });

            let fullResponse = '';
            for await (const chunk of stream) {
                if (isStoppedRef.current) break;
                const textChunk = chunk.text;
                fullResponse += textChunk;
                updateLastMessage(textChunk, false);
            }
          
            if (isStoppedRef.current) {
                updateLastMessage("\n\n— Generation stopped by user —", true);
            } else {
                updateLastMessage('', true);
                autoSpeak(fullResponse);
            }
        }
    } catch (err: any) {
        let friendlyMessage = `An error occurred: ${err.message}`;
        if (localImageFile) {
            friendlyMessage = `Sorry, I couldn't process that image. It might be in an unsupported format or exceed size limits. Please try another image. (Details: ${err.message})`;
        } else if (messageContent.trim().startsWith('/generate ')) {
            friendlyMessage = `Sorry, the image could not be generated. Please adjust your prompt or try again later. (Details: ${err.message})`;
        }

        setConversations(prev => {
            const updatedConversations = { ...prev };
            const current = updatedConversations[localChatId];
            if (current) {
                current.messages.pop(); // Remove loading indicator
                current.messages.push({ role: MessageRole.ERROR, content: friendlyMessage });
            }
            return updatedConversations;
        });
    } finally {
        setIsLoading(false);
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    await submitMessage(userInput);
  };

  const handleSuggestionClick = async (suggestion: string) => {
      await submitMessage(suggestion);
  };

  const startNewChat = () => {
    speechSynthesis.cancel();
    const newId = `chat_${Date.now()}`;
    const newConversation: Conversation = { id: newId, title: 'New Chat', messages: [] };
    setConversations(prev => ({ ...prev, [newId]: newConversation }));
    setCurrentChatId(newId);
  };
  
  const switchChat = (id: string) => {
    if (conversations[id]) {
      speechSynthesis.cancel();
      setCurrentChatId(id);
    }
  };

  const deleteChat = (id: string) => {
    speechSynthesis.cancel();
    setConversations(prev => {
      const newConversations = { ...prev };
      delete newConversations[id];
      
      if (currentChatId === id) {
        const remainingIds = Object.keys(newConversations).sort((a, b) => parseInt(b.split('_')[1]) - parseInt(a.split('_')[1]));
        if (remainingIds.length > 0) {
          setCurrentChatId(remainingIds[0]);
        } else {
          const newId = `chat_${Date.now()}`;
          newConversations[newId] = { id: newId, title: 'New Chat', messages: [] };
          setCurrentChatId(newId);
        }
      }
      return newConversations;
    });
  };
  
  const handleStop = () => {
    isStoppedRef.current = true;
    speechSynthesis.cancel();
  };

  const handleVoiceInput = () => {
    speechSynthesis.cancel();
    if (recognitionRef.current && !isRecording && !isLoading) {
      try {
        recognitionRef.current.start();
      } catch (error) {
        console.error("Error starting speech recognition:", error);
        setIsRecording(false);
      }
    }
  };

  const handleSummarize = async () => {
    if (!currentChatId || !conversations[currentChatId] || conversations[currentChatId].messages.length < 4) return;
    
    speechSynthesis.cancel();
    setIsSummarizing(true);
    setSummaryContent('');
    setIsSummaryModalOpen(true);

    try {
        const conversationHistory = conversations[currentChatId].messages
            .filter(m => m.role !== MessageRole.ERROR)
            .map(m => `${m.role === MessageRole.USER ? 'User' : 'Assistant'}: ${m.content}`)
            .join('\n\n');
        
        if (!API_KEY) {
            throw new Error("API_KEY environment variable not set.");
        }
        
        const ai = new GoogleGenAI({ apiKey: API_KEY });
        const prompt = `Please provide a concise summary of the following conversation:\n\n---\n\n${conversationHistory}\n\n---\n\nSummary:`;
        
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
        });

        setSummaryContent(response.text);

    } catch (err: any) {
        setSummaryContent(`An error occurred while generating the summary: ${err.message}`);
    } finally {
        setIsSummarizing(false);
    }
  };
  
  const toggleTts = () => {
      const newTtsState = !isTtsEnabled;
      setIsTtsEnabled(newTtsState);
      if (!newTtsState) {
          speechSynthesis.cancel();
      }
  };

  const toggleTheme = () => {
    const sequence: ('light' | 'dark' | 'system')[] = ['light', 'dark', 'system'];
    const currentIndex = sequence.indexOf(theme);
    const nextIndex = (currentIndex + 1) % sequence.length;
    setTheme(sequence[nextIndex]);
  };

  const handleCopy = (text: string, index: number) => {
    navigator.clipboard.writeText(text).then(() => {
        setCopiedMessageIndex(index);
        setTimeout(() => setCopiedMessageIndex(null), 2000);
    }).catch(err => {
        console.error('Failed to copy text: ', err);
    });
  };

  const handleExportChat = () => {
    if (!currentChatId || !conversations[currentChatId]) return;

    const conversation = conversations[currentChatId];
    let chatContent = `# ${conversation.title}\n\n`;

    conversation.messages.forEach(msg => {
        if (msg.role === MessageRole.ERROR) return;
        const role = msg.role.charAt(0).toUpperCase() + msg.role.slice(1);
        chatContent += `**${role}:**\n\n`;
        if(msg.imageUrl) {
            // For generated images, the prompt is in the content. For uploads, it's just the image.
            if (msg.content && msg.content.startsWith('>')) {
                 chatContent += `${msg.content}\n\n`;
            }
            chatContent += `![Image](image_data_in_export)\n\n`; // Note: actual data isn't in URL
        }
        if (msg.content && !msg.content.startsWith('>')) {
          chatContent += `${msg.content}\n\n`;
        }
        chatContent += `\n---\n\n`;
    });
    
    const blob = new Blob([chatContent], { type: 'text/markdown;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const fileName = `${conversation.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.md`;
    link.setAttribute('download', fileName);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };
  
  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (event.target) event.target.value = ''; // Clear the input immediately

    if (file) {
        if (!file.type.startsWith('image/')) {
            addMessageToCurrentChat({ role: MessageRole.ERROR, content: 'Invalid file type. Please select a valid image file (e.g., JPEG, PNG, WEBP).' });
            return;
        }

        const MAX_SIZE_MB = 10;
        if (file.size > MAX_SIZE_MB * 1024 * 1024) {
            addMessageToCurrentChat({ role: MessageRole.ERROR, content: `File is too large. Please select an image under ${MAX_SIZE_MB}MB.` });
            return;
        }

        setImageFile(file);
        const reader = new FileReader();
        reader.onloadend = () => {
            setImagePreview(reader.result as string);
        };
        reader.onerror = () => {
            addMessageToCurrentChat({ role: MessageRole.ERROR, content: 'Could not read the selected image. It might be corrupted. Please try another one.' });
            setImageFile(null);
            setImagePreview(null);
        };
        reader.readAsDataURL(file);
    }
  };

  const handleRemoveImage = () => {
      setImageFile(null);
      setImagePreview(null);
  };


  const currentConversation = conversations[currentChatId || ''];
  const sortedConversations = Object.values(conversations).sort((a, b) => parseInt(b.id.split('_')[1]) - parseInt(a.id.split('_')[1]));

  const renderMessageContent = (msg: Message) => {
    if (msg.role === MessageRole.ERROR) {
      return <p className="text-red-500 dark:text-red-400">{msg.content}</p>;
    }
    const html = marked.parse(msg.content, { breaks: true, gfm: true });
    return <div className="markdown-content" dangerouslySetInnerHTML={{ __html: html }} />;
  };

  return (
    <div className="h-screen relative">
        <aside className={`fixed top-0 left-0 h-full z-20 w-64 bg-white dark:bg-slate-800 p-2 flex flex-col border-r border-slate-200 dark:border-slate-700/50 transition-transform duration-300 ease-in-out ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
            <button
                onClick={startNewChat}
                className="mb-2 w-full border border-dashed border-slate-300 dark:border-slate-600 hover:border-indigo-500 dark:hover:border-indigo-500 text-slate-500 dark:text-slate-400 hover:text-indigo-500 dark:hover:text-indigo-400 font-semibold py-2 px-4 rounded-lg transition-colors duration-200 flex items-center justify-center gap-2"
            >
                <PlusIcon className="w-5 h-5" />
                New Chat
            </button>
            <div className="flex-grow overflow-y-auto pr-2">
                {sortedConversations.map(conv => (
                    <div
                        key={conv.id}
                        className={`history-item group flex items-center justify-between p-2 rounded-lg cursor-pointer mb-1 ${conv.id === currentChatId ? 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-slate-100' : 'hover:bg-slate-200/50 dark:hover:bg-slate-700/50'}`}
                        onClick={() => switchChat(conv.id)}
                    >
                        <span className="truncate text-sm font-medium">{conv.title}</span>
                        <button
                            className="delete-chat-btn opacity-0 group-hover:opacity-100 text-slate-500 hover:text-red-500 dark:text-slate-400 dark:hover:text-red-400 p-1 rounded-full transition-opacity"
                            onClick={(e) => { e.stopPropagation(); deleteChat(conv.id); }}
                            aria-label="Delete chat"
                            title="Delete chat"
                        >
                            <TrashIcon className="w-4 h-4" />
                        </button>
                    </div>
                ))}
            </div>
        </aside>

        <main className={`absolute top-0 bottom-0 right-0 flex flex-col bg-white dark:bg-slate-800 transition-all duration-300 ease-in-out ${isSidebarOpen ? 'left-64' : 'left-0'}`}>
            <header className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-700/50">
                <div className="flex items-center gap-4">
                    <button onClick={() => setSidebarOpen(!isSidebarOpen)} className="p-2 rounded-full text-slate-600 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-700/60 transition-colors duration-200" aria-label="Toggle sidebar">
                        <MenuIcon className="w-6 h-6" />
                    </button>
                    <h1 className="text-lg font-semibold truncate">{currentConversation?.title || 'CVS.ai'}</h1>
                </div>
                <div className="relative flex items-center gap-1">
                    <button
                        onClick={toggleTts}
                        className="p-2 rounded-full text-slate-600 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-700/60 transition-colors duration-200"
                        aria-label="Toggle auto text-to-speech"
                        title="Toggle auto text-to-speech"
                    >
                        {isTtsEnabled ? <SpeakerOnIcon className="w-5 h-5" /> : <SpeakerOffIcon className="w-5 h-5" />}
                    </button>
                    <button
                        onClick={handleSummarize}
                        className="p-2 rounded-full text-slate-600 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-700/60 transition-colors duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
                        disabled={isLoading || isSummarizing || !currentConversation || currentConversation.messages.length < 4}
                        aria-label="Summarize conversation"
                        title="Summarize conversation (min. 4 messages)"
                    >
                        <SummarizeIcon className="w-5 h-5" />
                    </button>
                    <button
                        onClick={handleExportChat}
                        className="p-2 rounded-full text-slate-600 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-700/60 transition-colors duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
                        disabled={!currentConversation || currentConversation.messages.length === 0}
                        aria-label="Export chat"
                        title="Export chat"
                    >
                        <ExportIcon className="w-5 h-5" />
                    </button>
                    <button onClick={toggleTheme} className="p-2 rounded-full text-slate-600 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-700/60 transition-colors duration-200" aria-label="Toggle theme" title={`Toggle theme (current: ${theme})`}>
                        {theme === 'light' && <SunIcon className="w-5 h-5" />}
                        {theme === 'dark' && <MoonIcon className="w-5 h-5" />}
                        {theme === 'system' && <SystemThemeIcon className="w-5 h-5" />}
                    </button>
                </div>
            </header>

            <div ref={chatContainerRef} className="flex-1 p-4 md:p-6 overflow-y-auto">
                <div className="max-w-3xl mx-auto w-full">
                    {currentConversation && currentConversation.messages.length > 0 ? (
                        currentConversation.messages.map((msg, index) => (
                           <div key={index} className={`flex w-full mb-6 items-start gap-3 group ${msg.role === MessageRole.USER ? 'justify-end' : ''}`}>
                                {msg.role !== MessageRole.USER && (
                                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center">
                                      <BotIcon className="w-5 h-5 text-slate-500 dark:text-slate-400" />
                                    </div>
                                )}
                                <div className={`flex flex-col ${msg.role === MessageRole.USER ? 'items-end' : 'items-start'}`}>
                                    <div className={`relative px-4 py-3 rounded-2xl max-w-xl lg:max-w-2xl ${msg.role === MessageRole.USER ? 'bg-indigo-600 text-white rounded-br-none' : 'bg-slate-200 dark:bg-slate-700 rounded-bl-none'}`}>
                                        {msg.content === LOADING_INDICATOR_CONTENT ? (
                                            <div className="flex items-center justify-center h-5">
                                                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-slate-500 dark:border-slate-400"></div>
                                            </div>
                                        ) : (
                                            <>
                                                {msg.imageUrl && (
                                                    <img src={msg.imageUrl} alt={msg.role === MessageRole.USER ? "User upload" : "Generated image"} className="mb-2 rounded-lg max-w-full h-auto border border-slate-300 dark:border-slate-600" />
                                                )}
                                                {msg.content && renderMessageContent(msg)}
                                            </>
                                        )}
                                    </div>
                                    <div className={`flex items-center gap-2 mt-1 px-1 h-5 ${msg.role === MessageRole.USER ? 'justify-end' : ''}`}>
                                      <div className="flex items-center gap-2 text-slate-400 dark:text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                                         <button onClick={() => handleCopy(msg.content, index)} title="Copy" className="hover:text-slate-600 dark:hover:text-slate-300 disabled:cursor-not-allowed" disabled={msg.role === MessageRole.ERROR || !msg.content}>
                                            {copiedMessageIndex === index ? 
                                                <CheckIcon className="w-4 h-4 text-green-500" />
                                                : <CopyIcon className="w-4 h-4" />
                                            }
                                         </button>
                                         {msg.role === MessageRole.MODEL && msg.content && !msg.content.startsWith('>') && (
                                             <button onClick={() => speak(msg.content)} title="Read aloud" className="hover:text-slate-600 dark:hover:text-slate-300">
                                                <SpeakerOnIcon className="w-4 h-4" />
                                             </button>
                                         )}
                                      </div>
                                    </div>
                                </div>
                                {msg.role === MessageRole.USER && (
                                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-indigo-500 flex items-center justify-center">
                                      <UserIcon className="w-5 h-5 text-white" />
                                    </div>
                                )}
                            </div>
                        ))
                    ) : (
                        <div className="flex flex-col justify-center items-center h-full text-center px-4">
                           <BrandIcon className="w-16 h-16 text-slate-300 dark:text-slate-600" />
                           <h2 className="text-2xl font-semibold text-slate-700 dark:text-slate-300 mt-4">How can I help you today?</h2>
                           <p className="text-slate-500 dark:text-slate-400 mt-2">"The best way to predict the future is to invent it."</p>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-12 w-full max-w-xl">
                                {promptSuggestions.map((s) => (
                                    <button
                                        key={s.title}
                                        onClick={() => handleSuggestionClick(s.prompt)}
                                        disabled={isLoading}
                                        className="suggestion-card relative p-4 rounded-lg text-left transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-100 dark:focus:ring-offset-slate-800 focus:ring-indigo-500 disabled:opacity-50"
                                    >
                                        <p className="font-semibold text-sm text-slate-700 dark:text-slate-200">{s.title}</p>
                                        <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{s.prompt}</p>
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            <div className="px-4 md:px-6 py-4 border-t border-slate-200 dark:border-slate-700/50">
                <div className="max-w-3xl mx-auto">
                    <form ref={formRef} onSubmit={handleSendMessage} className="relative">
                        {imagePreview && (
                            <div className="p-2 bg-slate-200 dark:bg-slate-600/50 rounded-t-2xl">
                                <div className="relative inline-block">
                                    <img src={imagePreview} alt="Image preview" className="max-h-24 rounded-lg" />
                                    <button 
                                        type="button" 
                                        onClick={handleRemoveImage} 
                                        className="absolute -top-2 -right-2 bg-slate-800 text-white rounded-full p-0.5 hover:bg-red-500 transition-colors"
                                        aria-label="Remove image"
                                    >
                                        <XIcon className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>
                        )}
                        <input
                            type="file"
                            ref={fileInputRef}
                            onChange={handleFileChange}
                            accept="image/*"
                            className="hidden"
                        />
                        <textarea
                            value={userInput}
                            onChange={(e) => setUserInput(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && !e.shiftKey) {
                                    e.preventDefault();
                                    handleSendMessage(e as any);
                                }
                            }}
                            rows={1}
                            className={`flex-1 w-full pl-12 pr-24 py-3 bg-slate-100 dark:bg-slate-700/50 rounded-2xl focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none ${imagePreview ? 'rounded-t-none' : ''}`}
                            placeholder="Ask me anything, or type '/generate' to create an image..."
                            autoComplete="off"
                            disabled={isLoading}
                        />
                        <div className="absolute left-3 top-0 bottom-0 flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            disabled={isLoading}
                            className="p-2 rounded-full text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
                            aria-label="Attach image"
                            title="Attach image"
                          >
                            <PaperclipIcon className="w-5 h-5" />
                          </button>
                          <button
                            type="button"
                            onClick={handleVoiceInput}
                            disabled={isLoading || !SpeechRecognition}
                            className={`p-2 rounded-full text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors duration-200 disabled:opacity-40 disabled:cursor-not-allowed ${isRecording ? 'is-recording' : ''}`}
                            aria-label="Use microphone"
                            title="Use microphone"
                          >
                            <MicrophoneIcon className="w-5 h-5" />
                          </button>
                        </div>
                        <div className="absolute right-3 top-0 bottom-0 flex items-center">
                          <button
                              type={isLoading ? 'button' : 'submit'}
                              disabled={!isLoading && !userInput.trim() && !imageFile}
                              className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold p-2 rounded-full transition-colors duration-200 flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed"
                              onClick={isLoading ? handleStop : undefined}
                              aria-label={isLoading ? "Stop generation" : "Send message"}
                              title={isLoading ? "Stop generation" : "Send message"}
                          >
                              {isLoading ? <StopIcon className="w-5 h-5" /> : <SendIcon className="w-5 h-5" />}
                          </button>
                        </div>
                    </form>
                </div>
            </div>
        </main>
        
        {isSummaryModalOpen && (
            <div className="fixed inset-0 bg-black bg-opacity-60 z-30 flex items-center justify-center p-4 backdrop-blur-sm" aria-modal="true" role="dialog">
                <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col border border-slate-200 dark:border-slate-700">
                    <div className="flex justify-between items-center p-4 border-b dark:border-slate-700">
                        <h3 className="text-lg font-semibold">Conversation Summary</h3>
                        <button onClick={() => setIsSummaryModalOpen(false)} className="p-1 rounded-full text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-600" aria-label="Close summary">
                            <XIcon className="w-6 h-6" />
                        </button>
                    </div>
                    <div className="p-6 overflow-y-auto">
                        {isSummarizing ? (
                            <div className="flex flex-col justify-center items-center py-10 space-y-4">
                                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 dark:border-indigo-400"></div>
                                <p className="text-slate-600 dark:text-slate-300">Generating summary...</p>
                            </div>
                        ) : (
                            <div className="markdown-content" dangerouslySetInnerHTML={{ __html: marked.parse(summaryContent, { breaks: true, gfm: true }) }}></div>
                        )}
                    </div>
                    <div className="p-4 border-t dark:border-slate-700 flex justify-end bg-slate-50 dark:bg-slate-800/50 rounded-b-lg">
                        <button onClick={() => setIsSummaryModalOpen(false)} className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-2 px-4 rounded-lg transition-colors">
                            Close
                        </button>
                    </div>
                </div>
            </div>
        )}
    </div>
  );
};

export default App;
