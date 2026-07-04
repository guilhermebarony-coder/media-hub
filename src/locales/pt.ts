// Português (Brasil). Mesmas chaves do en.ts — traduza apenas os valores.
// Qualquer chave ausente aqui cai automaticamente no inglês (en.ts).

export const pt: Record<string, string> = {
  // Seletor de idioma
  "lang.label": "Idioma",

  // Navegação lateral
  "nav.workspace": "Espaço de trabalho",
  "nav.system": "Sistema",
  "nav.download": "Baixar",
  "nav.library": "Biblioteca",
  "nav.projects": "Projetos",
  "nav.settings": "Configurações",
  "nav.help": "Ajuda",
  "nav.ready": "pronto",

  // Barra superior
  "topbar.activeLabel": "Ativo",
  "topbar.library": "Biblioteca",
  "topbar.libraryHint": "reutilizável, fica para sempre",
  "topbar.newProject": "Novo projeto…",
  "topbar.searchClips": "Buscar clipes…",
  "topbar.searchTitle": "Buscar clipes (Ctrl+Espaço)",
  "topbar.background": "Rodar em segundo plano — some na bandeja e continua baixando",
  "topbar.settings": "Configurações",
  "topbar.downloadingOne": "baixando",
  "topbar.downloadingMany": "downloads",
  "topbar.activeDownloadsTitle": "{n} {label} em andamento — clique para ver",
  "topbar.clip": "clipe",
  "topbar.clips": "clipes",

  // Introdução — estrutura
  "onb.aria": "Bem-vindo ao Media Hub",
  "onb.step.welcome": "Boas-vindas",
  "onb.step.library": "Configure sua biblioteca",
  "onb.step.cookies": "Cookies do navegador (opcional)",
  "onb.step.segments": "Como funcionam os downloads por trecho",
  "onb.stepper.current": "Passo {n} de 4 · {title}",
  "onb.skip": "Pular",
  "onb.skip.title": "Pular a introdução — você pode mudar tudo isso depois nas Configurações.",
  "onb.back": "Voltar",
  "onb.next": "Avançar",
  "onb.finish": "Concluir",

  // Introdução — boas-vindas
  "onb.welcome.title": "Sem enrolação. Só o clipe que você precisa.",
  "onb.welcome.lead":
    "O Media Hub é um app de desktop para editores e criadores buscarem mídia. Cole a URL de um vídeo — YouTube, Twitter/X, TikTok, Pinterest, Reddit, Instagram — navegue ou marque os tempos, pegue só o trecho que você quer — convertido num formato que seu editor curte de verdade (ProRes / DNxHR / MP4 otimizado), guardado numa biblioteca com tags que você consegue buscar um mês depois.",
  "onb.welcome.b1.t": "Download por trecho",
  "onb.welcome.b1.d": "nunca baixe um vídeo de 1 hora pra usar 5 segundos dele.",
  "onb.welcome.b2.t": "Conversões prontas pra edição",
  "onb.welcome.b2.d": "ProRes 422 LT e DNxHR SQ inclusos. Arraste direto pro Resolve / Premiere / Avid.",
  "onb.welcome.b3.t": "Biblioteca com tags + projetos",
  "onb.welcome.b3.d": "cada download vira um item. Busque e filtre por tag, canal ou origem.",
  "onb.welcome.b4.t": "Tudo local",
  "onb.welcome.b4.d": "os arquivos ficam no seu disco, em pastas que você abre direto. Sem amarração com a nuvem.",

  // Introdução — configuração
  "onb.cfg.title": "Configure sua biblioteca",
  "onb.cfg.lead": "Duas decisões rápidas. Você pode mudar as duas depois nas Configurações.",
  "onb.cfg.rootLabel": "Pasta da biblioteca",
  "onb.cfg.rootPlaceholder": "(padrão) ~/Media Hub",
  "onb.cfg.browse": "Procurar…",
  "onb.cfg.pickTitle": "Escolha a pasta da sua biblioteca",
  "onb.cfg.rootHintPre": "Onde os clipes baixados ficam no disco. Deixe vazio para o padrão (",
  "onb.cfg.rootHintPost": ").",
  "onb.cfg.presetLabel": "Conversão padrão",
  "onb.cfg.presetHint2":
    "ProRes 422 LT é o meio-termo ideal pra maioria dos fluxos de B-roll. Escolha \"None\" (Nenhuma) se quiser os arquivos exatamente como foram baixados.",

  // Introdução — cookies
  "onb.ck.title": "Cookies do navegador — só se você precisar",
  "onb.ck.lead":
    "Vídeos públicos funcionam sem nada disso em todas as fontes suportadas. Cookies só são necessários para clipes atrás de login — YouTube com restrição de idade, posts privados no Twitter/X, conteúdo só para membros e afins. Escolha Nenhum se não tiver certeza — ative depois quando esbarrar no bloqueio.",
  "onb.ck.calloutTitle": "Atenção — compatibilidade de cookies do navegador",
  "onb.ck.recommended": "Recomendado",
  "onb.ck.macOnly": "só no macOS",
  "onb.ck.recWhy": "Funcionam com o navegador aberto. O Firefox é o caminho mais fácil pro dia a dia.",
  "onb.ck.broken": "Sem funcionar no momento",
  "onb.ck.brokenWhy":
    "O Chrome 127+ adicionou a \"App-Bound Encryption\" — o yt-dlp não consegue descriptografar cookies de nenhum navegador Chromium no momento (yt-dlp issue #10927).",
  "onb.ck.tipLabel": "Dica —",
  "onb.ck.tip":
    "se seu navegador principal é o Chrome, entre no YouTube pelo Firefox uma vez e aponte o Media Hub para o Firefox. Ou use um arquivo cookies.txt exportado de qualquer navegador (modo de arquivo abaixo — funciona mesmo com tudo aberto).",
  "onb.ck.optNone": "Nenhum — pular cookies",
  "onb.ck.optBrowser": "Ler do navegador",
  "onb.ck.optFile": "Ler de arquivo cookies.txt",
  "onb.ck.browserLabel": "Navegador",
  "onb.ck.brokenSuffix": " (quebrado — DPAPI)",
  "onb.ck.chromiumWarn":
    "⚠ Navegadores Chromium não conseguem descriptografar cookies no momento. Escolha o Firefox acima ou mude para o modo de arquivo cookies.txt abaixo.",
  "onb.ck.fileLabel": "Caminho do cookies.txt",
  "onb.ck.fileHint":
    "Formato Netscape. Exporte do seu navegador com a extensão gratuita \"Get cookies.txt LOCALLY\" (Chrome / Firefox). Funciona mesmo com o navegador aberto.",

  // Introdução — fluxo de trabalho
  "onb.wf.title": "O fluxo de 30 segundos",
  "onb.wf.lead": "Esse é o ciclo que a maioria dos editores repete cem vezes por semana:",
  "onb.wf.s1.t": "Cole uma URL",
  "onb.wf.s1.d": " na página Baixar. Os dados e o player carregam em um ou dois segundos.",
  "onb.wf.s2.t": "Navegue para marcar trechos.",
  "onb.wf.s2.d1": " Aperte ",
  "onb.wf.s2.d2": " no ponto de entrada, avance e aperte ",
  "onb.wf.s2.d3": " no ponto de saída. Repita para vários cortes da mesma fonte.",
  "onb.wf.s3.t": "Escolha um formato + conversão",
  "onb.wf.s3.d": ", e baixe. O yt-dlp puxa a fonte uma vez e o ffmpeg corta cada trecho localmente — economizando banda.",
  "onb.wf.s4.t": "Os arquivos chegam na sua biblioteca",
  "onb.wf.s4.d": ", com tags do canal + URL de origem. Abra direto no seu editor.",
  "onb.wf.proLabel": "Dica pro — integração com pasta monitorada.",
  "onb.wf.proBody":
    "Aponte o navegador de mídia do seu editor para ~/Media Hub/Library/raw/ (ou a pasta raw/ do seu projeto). Todo clipe que você baixa é importado automaticamente. O Resolve chama isso de \"Auto-Sync Bin\"; o Premiere tem o Media Browser; o FCP usa pastas de eventos monitoradas.",
};
