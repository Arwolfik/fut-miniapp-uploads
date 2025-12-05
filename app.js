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

let currentRecordId = null; // PK (Id / id) из NocoDB
let userPlatform = null;    // 'tg' или 'vk'
let rawUserId = null;

const uploadState = {
    1: false,
    2: false,
    3: false
};

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

// Ждём vkBridge (для VK Mini Apps)
async function waitForVkBridge() {
    return new Promise(resolve => {
        if (window.vkBridge) return resolve(vkBridge);
        const timer = setInterval(() => {
            if (window.vkBridge) {
                clearInterval(timer);
                resolve(window.vkBridge);
            }
        }, 50);
        setTimeout(() => { clearInterval(timer); resolve(null); }, 4000);
    });
}

/**
 * Ищем пользователя по полю `tg-id`.
 * Варианты значений: "123456" или "123456_VK".
 */
async function findUser(id) {
    const idStr = String(id);

    const tgVal = encodeURIComponent(idStr);           // "123456"
    const vkVal = encodeURIComponent(`${idStr}_VK`);  // "123456_VK"

    // Ищем tg-id == id ИЛИ tg-id == id_VK
    const url = `${RECORDS_ENDPOINT}?where=(tg-id,eq,${tgVal})~or(tg-id,eq,${vkVal})&fields=*`;
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

/**
 * Гарантируем, что currentRecordId заполнен:
 * если он пустой — повторно ищем пользователя в базе.
 */
async function ensureRecordId() {
    if (currentRecordId !== null && currentRecordId !== undefined && currentRecordId !== "") {
        return currentRecordId;
    }

    console.warn("ensureRecordId: currentRecordId пустой, пробуем найти пользователя заново. rawUserId =", rawUserId);

    if (!rawUserId) {
        throw new Error("Не удалось определить пользователя. Перезапустите мини-апп.");
    }

    const user = await findUser(rawUserId);
    console.log("Повторный поиск пользователя в ensureRecordId:", user);

    if (!user || !user.recordId) {
        throw new Error("Не удалось найти вашу запись в базе. Напишите в бот.");
    }

    currentRecordId = user.recordId;
    if (user.platform) {
        userPlatform = user.platform;
    }

    console.log("ensureRecordId: восстановили currentRecordId =", currentRecordId);
    return currentRecordId;
}

async function uploadFile(recordId, fieldId, file, extra = {}) {
    if (recordId === null || recordId === undefined || recordId === "") {
        throw new Error("Не найден ID вашей записи. Попробуйте перезапустить мини-апп.");
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
        Id: recordId,          // PK — то, что вернули из findUser/ensureRecordId
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
        // 1. Ждём VK Bridge
        const bridge = await waitForVkBridge();

        if (bridge) {
            await bridge.send("VKWebAppInit");
            const info = await bridge.send("VKWebAppGetUserInfo");
            rawUserId = info.id;
            userPlatform = "vk";
            console.log("VK пользователь:", rawUserId);
        } else if (window.Telegram?.WebApp?.initDataUnsafe?.user?.id) {
            // 2. Если не VK — значит Telegram
            const tg = window.Telegram.WebApp;
            tg.ready();
            tg.expand();
            rawUserId = tg.initDataUnsafe.user.id;
            userPlatform = "tg";
            console.log("Telegram пользователь:", rawUserId);
        } else {
            throw new Error("Платформа не определена");
        }

        console.log("rawUserId =", rawUserId, "platform (из окружения) =", userPlatform);

        // 3. Ищем пользователя в базе по tg-id (учитываем _VK)
        const user = await findUser(rawUserId);
        console.log("findUser вернул:", user);

        if (!user) {
            throw new Error("Вы не зарегистрированы. Напишите в бот");
        }

        currentRecordId = user.recordId;
        userPlatform = user.platform || userPlatform;

        console.log("currentRecordId =", currentRecordId, "platform (уточнён) =", userPlatform);

        // 4. Показываем первый экран
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
    // Если уже идёт загрузка этого шага — игнорируем повторный клик
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
        // 🔁 Критично: гарантируем, что у нас есть recordId
        const recordId = await ensureRecordId();

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

document
    .getElementById("submitFile1")
    ?.addEventListener("click", () =>
        handleUpload(1, SOLUTION_FIELDS.solution1, "upload2")
    );
document
    .getElementById("submitFile2")
    ?.addEventListener("click", () =>
        handleUpload(2, SOLUTION_FIELDS.solution2, "upload3")
    );
document
    .getElementById("submitFile3")
    ?.addEventListener("click", () =>
        handleUpload(3, SOLUTION_FIELDS.solution3)
    );

document
    .getElementById("skipFile2")
    ?.addEventListener("click", () => showScreen("result"));
document
    .getElementById("skipFile3")
    ?.addEventListener("click", () => showScreen("result"));

document.getElementById("closeApp")?.addEventListener("click", () => {
    if (userPlatform === "vk" && window.vkBridge) {
        vkBridge.send("VKWebAppClose", { status: "success" });
    } else if (window.Telegram?.WebApp) {
        window.Telegram.WebApp.close();
    }
});
