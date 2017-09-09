const express   = require("express");
const morgan    = require("morgan");
const multipart = require("connect-multiparty");
const port      = process.env.PORT || 3000;

const app                 = express();
const multipartMiddleware = multipart();


app.use(morgan(":method :url :status :res[content-length] - :response-time ms"));

app.get("/analyze", (req, res) => {
    return res.sendFile("index.html", {root: __dirname });
});

app.post("/analyze", multipartMiddleware, (req, res) => {
    console.log(req.body, req.files);
    return res.redirect("/analyze");
});

app.listen(port, () => {
    console.log(`App listening on port ${port}.`);
});