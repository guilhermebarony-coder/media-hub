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

  // Configurações — página + comuns
  "set.title": "Configurações",
  "set.browse": "Procurar…",
  "set.opt.none": "Nenhum",
  "set.opt.fromBrowser": "Do navegador",
  "set.opt.fromFile": "De arquivo",
  "set.reset.confirm": "Restaurar os padrões desta seção?",
  "set.reset.title": "Restaurar seção?",
  "set.reset.label": "Restaurar",

  // Configurações — Fontes
  "set.sec.sources": "Fontes",
  "set.chip.cookies": "cookies do navegador",
  "set.src.intro":
    "Alguns vídeos exigem login — YouTube com restrição de idade, posts privados no Twitter/X, conteúdo só para membros. Aponte para um navegador onde você está logado e o Media Hub usará os cookies. Vídeos públicos funcionam sem nada disso — deixe em Nenhum se não esbarrar no bloqueio.",
  "set.src.browserLogin": "Login do navegador",
  "set.src.loginOn": "O Media Hub usa os cookies que a extensão sincroniza do seu navegador, para downloads restritos.",
  "set.src.loginOff": "Desligado — vídeos restritos/privados podem falhar até você ativar isto (ou escolher uma fonte abaixo).",
  "set.src.mode": "Modo",
  "set.src.browser": "Navegador",
  "set.src.path": "Caminho",
  "set.src.perSite": "Regras por site",
  "set.src.noRules": "Nenhuma regra por site ainda — todos os sites usam o padrão acima.",
  "set.src.addRule": "+ Adicionar regra de site…",

  // Configurações — Biblioteca
  "set.sec.library": "Biblioteca",
  "set.chip.library": "pasta + renomear",
  "set.lib.intro":
    "Escolha onde o Media Hub guarda os downloads e como os arquivos são nomeados. Editar o caminho aqui só redireciona downloads futuros; use \"Mover biblioteca\" abaixo para também mudar de lugar tudo o que você já baixou.",
  "set.lib.root": "Pasta da biblioteca",
  "set.lib.rootHint": "Vazio = padrão. Editar aqui só afeta novos downloads.",
  "set.lib.move": "Mover biblioteca",
  "set.lib.moveBtn": "Mover biblioteca existente para…",
  "set.lib.moving": "Movendo…",
  "set.lib.renamePreset": "Padrão de nome",
  "set.lib.template": "Modelo",

  // Configurações — Downloads
  "set.sec.downloads": "Downloads",
  "set.chip.downloads": "processos + limite",
  "set.dl.intro":
    "Quantos downloads rodam ao mesmo tempo, um limite de velocidade opcional e a memória de formato por site.",
  "set.dl.workers": "Downloads paralelos",
  "set.dl.quality": "Qualidade preferida",
  "set.dl.qualitySource": "Original (sem limite)",
  "set.dl.bandwidth": "Velocidade",
  "set.dl.throttle": "Limitar",
  "set.dl.fast": "Downloads rápidos",
  "set.dl.fastFetching": "Baixando o motor aria2c…",
  "set.dl.preview": "Qualidade da prévia",
  "set.dl.previewAuto": "Automática (pela duração)",
  "set.dl.previewStreaming": "Só streaming",
  "set.dl.clearCache": "Limpar cache",
  "set.dl.openFolder": "Abrir pasta",
  "set.dl.sticky": "Formatos memorizados",
  "set.dl.stickyNone": "nenhum ainda — o primeiro formato baixado por plataforma é lembrado automaticamente",
  "set.dl.forget": "Esquecer",
  "set.dl.forgetAll": "Esquecer tudo",
  "set.dl.jog": "Jog do player",

  // Configurações — Conversão
  "set.sec.transcode": "Conversão",
  "set.chip.transcode": "conversão padrão",
  "set.tr.intro":
    "Novos downloads usam esta conversão por padrão. Você ainda pode escolher outra em cada download. Deixe em Nenhum a menos que seu editor tenha dificuldade com o arquivo original.",
  "set.tr.default": "Conversão padrão",

  // Configurações — Ponte do navegador
  "set.sec.bridge": "Ponte do navegador",
  "set.chip.bridge": "extensão + scripts",
  "set.br.intro":
    "O Media Hub roda um pequeno servidor no seu próprio computador (127.0.0.1) para a extensão do navegador enviar URLs para a fila de download. Ele nunca fica exposto na rede. Cole o token + a URL abaixo na extensão para parear uma vez.",
  "set.br.enabled": "Ativado",
  "set.br.enabledOn": "o servidor inicia no próximo lançamento",
  "set.br.enabledOff": "servidor desligado — a extensão não alcança o app",
  "set.br.port": "Porta",
  "set.br.portHint": "mudar exige reiniciar o app",
  "set.br.token": "Token",
  "set.br.copy": "Copiar",
  "set.br.copied": "✓ Copiado",
  "set.br.regenerate": "Gerar novo",

  // Configurações — Diagnóstico
  "set.sec.diag": "Diagnóstico",
  "set.chip.diag": "somente leitura",
  "set.diag.intro":
    "Uma checagem rápida das ferramentas incluídas e de onde os arquivos ficam. Se algo parecer quebrado, olhe aqui primeiro.",
  "set.diag.tools": "Ferramentas de mídia",
  "set.diag.repair": "Reparar ferramentas",
  "set.diag.repairing": "Configurando…",
  "set.diag.recheck": "Verificar versões",
  "set.diag.checking": "Verificando…",
  "set.diag.engine": "Motor yt-dlp",
  "set.diag.updateEngine": "Atualizar motor agora",
  "set.diag.updating": "Atualizando…",
  "set.diag.app": "App Media Hub",
  "set.diag.checkUpdates": "Procurar atualizações",
  "set.diag.working": "Trabalhando…",
  "set.diag.log": "Log de diagnóstico",
  "set.diag.openLogs": "Abrir pasta de logs",
  "set.diag.toolsDownloading": "Baixando ferramentas de mídia…",
  "set.diag.toolsReady": "Ferramentas prontas.",

  // Configurações — Sobre
  "set.sec.about": "Sobre",
  "set.about.intro":
    "App de desktop para buscar e organizar mídia para editores de vídeo. Feito com Tauri 2 + React + Rust. Inclui yt-dlp + ffmpeg.",
  "set.about.version": "Versão",
  "set.about.identifier": "Identificador",
};
