# Media Hub — Extensão de Navegador

Envie vídeos do seu navegador direto pro Media Hub com um clique.

> 🇺🇸 **English version:** [README.md](./README.md)

---

## ✅ Antes de começar

1. **O aplicativo Media Hub precisa estar instalado e ABERTO.** A
   extensão conversa com o app — se o app estiver fechado, nada acontece.
2. Você vai precisar do **token de pareamento** do app. A gente pega ele
   no Passo 2 abaixo. Relaxa, é só um copiar e colar.

---

## 📦 Passo 1 — Instalar a extensão (Chrome / Edge / Brave)

1. Abra uma nova aba, digite isto na barra de endereço e aperte Enter:
   ```
   chrome://extensions
   ```
   *(No Edge use `edge://extensions`, no Brave use `brave://extensions`.)*

2. Ache o botão **"Modo do desenvolvedor"** (ou "Developer mode") no
   **canto superior direito** e **LIGUE** ele.

3. Vão aparecer botões novos. Clique em **"Carregar sem compactação"**
   (ou "Load unpacked").

4. Vai abrir uma janela pra escolher pasta. Navegue até a **pasta
   `extension`** (a pasta onde está este arquivo) e selecione ela.
   Clique em **"Selecionar pasta"**.

5. Pronto — vai aparecer um cartão **"Media Hub"** e um ícone novo na
   barra do navegador (canto superior direito; pode estar escondido
   atrás do ícone de peça de quebra-cabeça 🧩 — clique nele e fixe o
   Media Hub).

---

## 🔑 Passo 2 — Abrir o app e pegar seu token

1. Abra o **aplicativo Media Hub**.
2. Vá em **Settings / Configurações** (ícone de engrenagem, canto
   superior direito).
3. Role até a seção **"Browser bridge"** (ponte do navegador).
4. Você vai ver um campo **Token** com um monte de letras e números.
   Clique no botão **"Copy" / "Copiar"** do lado.

---

## 🔗 Passo 3 — Parear a extensão com o app

1. Clique no **ícone da extensão Media Hub** na barra do navegador.
2. Clique em **"Options" / "Opções"** lá embaixo do popup.
3. Vai abrir uma aba de configurações. **Cole o seu token** no campo
   **"Bridge token"** (Ctrl+V).
4. Clique em **"Save" / "Salvar"**.
5. Clique em **"Test connection" / "Testar conexão"**. Deve aparecer uma
   mensagem **verde**: *"Connected · Media Hub v1.2.15"*. 🎉

   ❌ Se aparecer "couldn't reach app" (não consegui achar o app) —
   confira se o **aplicativo está aberto** e tente de novo.

---

## 🚀 Como usar

Você tem **quatro formas** de mandar um vídeo. Use a que for mais
confortável:

### 1. O botão na barra do navegador (funciona em todo lugar)
- Clique no **ícone do Media Hub** na barra.
- Escolha o formato: **Video / MP3 / M4A / FLAC**.
- Clique em **"Send to Media Hub"**. Pronto — já tá baixando no app.

### 2. O botão em cima do vídeo (Twitter/X e Reddit)
- No **x.com** ou **reddit.com**, passe o mouse em cima de qualquer
  vídeo.
- Aparece um botãozinho verde-limão **"● Media Hub"** no canto.
- Clique nele. Aquele vídeo específico vai pro app.

### 3. Botão direito do mouse
- Clique com o botão direito num vídeo, link ou página →
  **"Send to Media Hub"**.
- ⚠️ No YouTube/Twitter isso pode não aparecer (esses sites bloqueiam o
  botão direito). Nesses casos use a forma 1 ou 4.

### 4. Atalhos de teclado (mais rápido)
- **Ctrl + Shift + Y** → manda a aba atual como **vídeo**
- **Ctrl + Shift + M** → manda a aba atual como **MP3**
- Esses funcionam até no YouTube, onde o botão direito é bloqueado.

---

## 🌐 O que funciona em cada site

| Site | Melhor jeito de enviar |
|------|------------------------|
| **YouTube** | Botão da barra, ou `Ctrl+Shift+Y` |
| **Twitter / X** | Passe o mouse no vídeo → clique no botão verde |
| **Reddit** | Passe o mouse no vídeo → clique no botão verde |
| **Instagram** | Botão da barra (o player deles bloqueia o botão no vídeo) |
| **Qualquer outro site** | Botão da barra, ou a lista "Detected" no popup |

**Lista "Detected on this tab" (detectados nesta aba):** quando você abre
o popup, ele também mostra os vídeos que percebeu carregando na página
(ótimo pra sites complicados com vários vídeos). Clique no 👁 pra
visualizar um, ou clique na linha pra enviar.

---

## ❓ Resolvendo problemas

**O botão em cima do vídeo não aparece.**
→ Atualize a página (**Ctrl+F5**). O botão só aparece em páginas que
acabaram de carregar.

**"Media Hub offline" / não conecta.**
→ O aplicativo não está aberto. Abra ele e tente de novo. O popup tem um
botão **"Try launching app"** que pode abrir o app pra você.

**O menu do botão direito não aparece no YouTube/Twitter.**
→ Esses sites bloqueiam o botão direito. Use o botão da barra ou o
atalho de teclado (`Ctrl+Shift+Y`).

**Mudei o token / a porta no app.**
→ Abra de novo as **Opções** da extensão, cole o token novo, salve.
(Se você mudou a **porta**, reinicie também o aplicativo.)

**Atualizou os arquivos da extensão?**
→ Vá em `chrome://extensions` e clique no **ícone de recarregar 🔄** no
cartão do Media Hub.

---

## 🔒 Isso é seguro / privado?

Sim.

- A extensão **só conversa com o seu próprio computador** (`127.0.0.1`,
  o endereço local). Ela nunca manda nada pra internet nem pra gente.
- Ela só envia o link de um vídeo quando **você clica num botão** — ela
  nunca baixa nem transmite nada sozinha.
- O token de pareamento fica guardado no armazenamento privado do
  navegador e funciona como uma senha, pra que sites aleatórios não
  consigam disparar downloads no seu app.
- A lista "Detected" lê os links de vídeo conforme a página carrega, mas
  mantém eles **só na memória** e esquece tudo quando você fecha a aba.

---

## 🦊 Observação sobre o Firefox

1. Vá em `about:debugging#/runtime/this-firefox`.
2. Clique em **"Carregar extensão temporária…"** ("Load Temporary
   Add-on…").
3. Selecione o arquivo **`manifest.json`** dentro da pasta da extensão.
4. Depois siga o Passo 2 + Passo 3 acima pra parear.

⚠️ O Firefox esquece extensões temporárias quando você fecha o navegador
— você teria que adicionar de novo a cada sessão. Pro dia a dia, o
Chrome/Edge/Brave funciona melhor por enquanto.

---

## 🛠 Para desenvolvedores

```
extension/
├─ manifest.json        ← Manifesto MV3 (+ compat. Firefox)
├─ bridge.js            ← Cliente HTTP compartilhado (popup + background)
├─ popup.html/css/js    ← Popup da barra de ferramentas
├─ options.html/css/js  ← Página de pareamento / configurações
├─ background.js        ← Service worker: menu de contexto, atalhos, roteador de mensagens
├─ sniffer.js           ← Detector passivo de streams por aba
├─ content-twitter.js   ← Botão no vídeo em x.com / twitter.com
├─ content-reddit.js    ← Botão no vídeo em reddit.com
├─ content-overlay.css  ← Estilo compartilhado do botão sobreposto
└─ icons/
```

Sem etapa de build — são módulos ES puros servidos do disco. Edite um
arquivo, clique no ícone de recarregar em `chrome://extensions`, pronto.
Todo o tráfego é só local (`127.0.0.1:47821` por padrão); o token da
ponte (em `chrome.storage.local`) é a autenticação.
