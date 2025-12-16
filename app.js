const BASE_URL = "https://ndb.fut.ru";
const TABLE_ID = "m6tyxd3346dlhco";
const API_KEY = "crDte8gB-CSZzNujzSsy9obQRqZYkY3SNp8wre88";

const RECORDS_ENDPOINT = `${BASE_URL}/api/v2/tables/${TABLE_ID}/records`;
const FILE_UPLOAD_ENDPOINT = `${BASE_URL}/api/v2/storage/upload`;

const SOLUTION_FIELDS = {
    solution1: "cckbnapoy433x0p",
    solution2: "cd4uozpxqsupg9y",
    solution3: "c9d7t4372ag9rl8"
};
const DATE_FIELD_ID = "ckg3vnwv4h6wg9a";

let userPlatform = null;    // 'tg' или 'vk'
let rawUserId = null;       // реальный id из TG/VK

const uploadState = { 1: false, 2: false, 3: false };

const screens = {
    welcome: document.getElementById("welcomeScreen"),
    upload1: document.getElementById("uploadScreen1"),
    upload2: document.getElementById("uploadScreen2"),
    upload3: document.getElementById("uploadScreen3"),
    result: document.getElementById("resultScreen")
};

function showScreen(id) {
    Object.values(screens).forEach(s => s?.classList.add("hidden"));
    screens[id]?.classList.remove("hidden");
}

function showError(msg) {
    document.body.innerHTML = `<div style="padding:50px;text-align:center;color:white;">
        <h2>Ошибка</h2>
        <p style="font-size:18px;margin:30px 0;">${msg}</p>
        <button onclick="location.reload()" style="padding:15px 30px;font-size:17px;">Обновить</button>
    </div>`;
}

/**
 * Ищем пользователя по полю `tg-id`.
 * Варианты значений: "123456" или "123456_VK".
 */
async function findUser(id) {
    const idStr = String(id);

    const tgVal = encodeURIComponent(idStr);           // "123456"
    const vkVal = encodeURIComponent(`${idStr}_VK`);  // "123456_VK"

    const url =
        `${RECORDS_ENDPOINT}?where=` +
        `(tg-id,eq,${tgVal})~or(tg-id,eq,${vkVal})&fields=*`;

    console.log("Запрос поиска пользователя:", url);

    const res = await fetch(url, {
        headers: {
            "Content-Type": "application/json",
            "accept": "application/json",
            "xc-token": API_KEY
        }
    });

    const data = await res.json();
    console.log("Ответ поиска по tg-id:", data);

    if (!data.list || data.list.length === 0) {
        console.log("Пользователь НЕ найден по tg-id ни как TG, ни как VK");
        return null;
    }

    const rec = data.list[0];
    console.log("Найдена строка:", rec);

    // Пытаемся понять, какое поле — PK
    let recordId = rec.Id ?? rec.id ?? rec.ID;

    if (recordId === null || recordId === undefined || recordId === "") {
        console.warn("В найденной записи нет корректного PK (Id/id). Ключи записи:", Object.keys(rec));
        return null;
    }

    // Определяем платформу по содержимому tg-id (если нужно)
    let platform = "tg";
    const tgFieldValue = rec["tg-id"] ?? rec["tg id"];
    if (typeof tgFieldValue === "string" && tgFieldValue.endsWith("_VK")) {
        platform = "vk";
    }

    console.log("Итог findUser → recordId =", recordId, "platform =", platform);
    return { recordId, platform };
}

async function uploadFile(recordId, fieldId, file, extra = {}) {
    if (!recordId && recordId !== 0) {
        throw new Error("Не найден ID вашей записи в базе.");
    }

    // 1. Загружаем файл в storage
    const form = new FormData();
    form.append("file", file);
    form.append("path", "solutions");

    const up = await fetch(FILE_UPLOAD_ENDPOINT, {
        method: "POST",
        headers: { "xc-token": API_KEY },
        body: form
    });

    if (!up.ok) {
        const text = await up.text();
        throw new Error("Не удалось загрузить файл: " + up.status + " " + text);
    }

    const info = await up.json();
    const url = Array.isArray(info)
        ? (info[0].url || `${BASE_URL}/${info[0].path}`)
        : info.url;

    const fileObj = {
        title: file.name,
        url: url,
        mimetype: file.type || "application/octet-stream",
        size: file.size
    };

    // 2. Обновляем запись в таблице
    const body = {
        Id: recordId,          // PK — то, что вернули из findUser
        [fieldId]: [fileObj],  // Attachment как массив
        ...extra
    };
    console.log("PATCH body:", body);

    const patch = await fetch(RECORDS_ENDPOINT, {
        method: "PATCH",
        headers: {
            "Content-Type": "application/json",
            "accept": "application/json",
            "xc-token": API_KEY
        },
        body: JSON.stringify(body)
    });

    if (!patch.ok) {
        const err = await patch.text();
        throw new Error("Ошибка сохранения: " + err);
    }

    console.log("Файл успешно прикреплён! ID записи:", recordId);
}

// Прогресс-бар
async function showProgress(barId, statusId) {
    const bar = document.getElementById(barId);
    const status = document.getElementById(statusId);
    let p = 0;
    return new Promise(res => {
        const int = setInterval(() => {
            p += 15 + Math.random() * 25;
            if (p >= 100) {
                p = 100;
                clearInterval(int);
                status.textContent = "Готово!";
                res();
            }
            bar.style.width = p + "%";
            status.textContent = `Загрузка ${Math.round(p)}%`;
        }, 100);
    });
}

// ======================= ЗАПУСК =======================
(async () => {
    try {
        // 1. Проверяем, есть ли настоящий Telegram-пользователь
        const telegramUserId = window.Telegram?.WebApp?.initDataUnsafe?.user?.id;

        if (telegramUserId) {
            const tg = window.Telegram.WebApp;
            tg.ready();
            tg.expand();

            rawUserId = telegramUserId;
            userPlatform = "tg";

            console.log("Telegram WebApp initDataUnsafe:", window.Telegram.WebApp.initDataUnsafe);
            console.log("Telegram пользователь:", rawUserId);
        }

        // 2. Если Telegram-пользователя нет — пробуем VK
        else if (window.vkBridge) {
            const bridge = window.vkBridge;

            console.log("VK Bridge найден, отправляем VKWebAppInit");
            await bridge.send("VKWebAppInit");

            const info = await bridge.send("VKWebAppGetUserInfo");
            rawUserId = info.id;
            userPlatform = "vk";
            console.log("VK пользователь:", rawUserId);
        }

        // 3. Ничего не нашли — вообще не тот запуск
        else {
            throw new Error("Платформа не определена (ни Telegram с initData, ни vkBridge). Откройте мини-апп из бота или VK.");
        }

        console.log("rawUserId =", rawUserId, "platform (из окружения) =", userPlatform);

        // 4. Лёгкая проверка, что пользователь есть в базе
        const user = await findUser(rawUserId);
        if (!user) {
            throw new Error("Вы не зарегистрированы. Напишите в бот");
        }
        userPlatform = user.platform || userPlatform;

        // 5. Показываем первый экран
        showScreen("welcome");
    } catch (err) {
        console.error(err);
        showError(err.message || "Ошибка приложения");
    }
})();

// ======================= КНОПКИ =======================
document.getElementById("startUpload")?.addEventListener("click", () =>
    showScreen("upload1")
);

async function handleUpload(num, fieldId, nextScreen = null) {
    if (uploadState[num]) {
        console.log(`Загрузка #${num} уже идёт — повторный клик игнорируем`);
        return;
    }

    const input = document.getElementById(`fileInput${num}`);
    const err = document.getElementById(`error${num}`);
    const btn = document.getElementById(`submitFile${num}`);
    const file = input.files[0];
    err.classList.add("hidden");

    if (!file) {
        err.textContent = "Выберите файл";
        err.classList.remove("hidden");
        return;
    }
    if (file.size > 15 * 1024 * 1024) {
        err.textContent = "Файл больше 15 МБ";
        err.classList.remove("hidden");
        return;
    }

    uploadState[num] = true;
    if (btn) {
        btn.disabled = true;
        btn.dataset.originalText = btn.textContent;
        btn.textContent = "Загружаем...";
    }

    try {
        if (!rawUserId) {
            throw new Error("Не удалось определить пользователя. Перезапустите мини-апп.");
        }

        const user = await findUser(rawUserId);
        console.log("handleUpload → findUser:", user);

        if (!user || !user.recordId) {
            throw new Error("Не удалось найти вашу запись. Напишите в бот.");
        }

        const recordId = user.recordId;

        await showProgress(`progress${num}`, `status${num}`);
        const extra =
            num === 1
                ? { [DATE_FIELD_ID]: new Date().toISOString().split("T")[0] }
                : {};
        await uploadFile(recordId, fieldId, file, extra);
        nextScreen ? showScreen(nextScreen) : showScreen("result");
    } catch (e) {
        console.error(e);
        err.textContent = e.message || "Ошибка загрузки";
        err.classList.remove("hidden");
    } finally {
        uploadState[num] = false;
        if (btn) {
            btn.disabled = false;
            if (btn.dataset.originalText) {
                btn.textContent = btn.dataset.originalText;
            }
        }
    }
}

document.getElementById("submitFile1")?.addEventListener("click", () =>
    handleUpload(1, SOLUTION_FIELDS.solution1, "upload2")
);
document.getElementById("submitFile2")?.addEventListener("click", () =>
    handleUpload(2, SOLUTION_FIELDS.solution2, "upload3")
);
document.getElementById("submitFile3")?.addEventListener("click", () =>
    handleUpload(3, SOLUTION_FIELDS.solution3)
);

document.getElementById("skipFile2")?.addEventListener("click", () =>
    showScreen("result")
);
document.getElementById("skipFile3")?.addEventListener("click", () =>
    showScreen("result")
);

document.getElementById("closeApp")?.addEventListener("click", () => {
    if (userPlatform === "vk" && window.vkBridge) {
        window.vkBridge.send("VKWebAppClose", { status: "success" });
    } else if (window.Telegram?.WebApp) {
        window.Telegram.WebApp.close();
    }
});
