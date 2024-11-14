const express = require("express");
const morgan = require("morgan");
const flash = require("express-flash")
const session = require("express-session");
const { body, validationResult } = require("express-validator");
const TodoList = require("./lib/todolist");
const Todo = require("./lib/todo");
const { sortTodoLists, sortTodos } = require("./lib/sort");
const store = require("connect-loki");

const app = express();
const host = "localhost";
const port = 3000;
const LokiStore = store(session);

app.set("views", "./views");
app.set("view engine", "pug");

app.use(morgan("common"));
app.use(express.static("public"));
app.use(express.urlencoded({ extended: false }));
app.use(session({
  cookie: {
    httpOnly: true,
    maxAge: 31 * 24 * 60 * 60 * 1000,
    path: "/",
    secure: false,
  },
  name: "launch-school-todos-session-id",
  resave: false,
  saveUninitialized: true,
  secret: "this is not very secure",
  store: new LokiStore({}),
}));
app.use(flash());
app.use((req, res, next) => {
  res.locals.flash = req.session.flash;
  delete req.session.flash;
  next();
});
app.use((req, res, next) => {
  let todoLists = [];
  if ("todoLists" in req.session) {
    req.session.todoLists.forEach(todoList => {
      todoLists.push(TodoList.makeTodoList(todoList));
    });
  }

  req.session.todoLists = todoLists;
  next();
});

const loadTodoList = (todoListId, todoLists) => {
  return todoLists.find(todoList => todoList.id === todoListId);
};

const loadTodo = (todoListId, todoId, todoLists) => {
  let todoList = loadTodoList(todoListId, todoLists);
  if (!todoList) return undefined;

  return todoList.todos.find(todo => todo.id === todoId);
};

app.get("/", (req, res) => {
  res.redirect("/lists");
});

app.get("/lists", (req, res) => {
  res.render("lists", {
    todoLists: sortTodoLists(req.session.todoLists),
  });
});

app.get("/lists/new", (req, res) => {
  res.render("new-list");
});

app.post("/lists", 
  [
    body("todoListTitle")
      .trim()
      .isLength({ min: 1})
      .withMessage("The list title is required.")
      .isLength({ max: 100 })
      .withMessage("List title must be between 1 and 100 characters.")
      .custom((title, { req }) => {
        let todoLists = req.session.todoLists;
        return !todoLists.some(list => list.title === title);
      })
      .withMessage("List title must be unique."),
  ],
  (req, res) => {
  let errors = validationResult(req);
  if (!errors.isEmpty()) {
    errors.array().forEach(message => req.flash("error", message.msg));
    res.render("new-list", {
      flash: req.flash(),
      todoListTitle: req.body.todoListTitle,
    });
  } else {
    req.session.todoLists.push(new TodoList(req.body.todoListTitle));
    req.flash("success", "The todo list has been created.");
    res.redirect("/lists");
  }
 }
);

app.get("/lists/:todoListId", (req, res, next) => {
  let todoListId = req.params.todoListId;
  let todoList = loadTodoList(+todoListId, req.session.todoLists);
  if (todoList === undefined) {
    next(new Error("Not found."));
  } else {
    res.render("list", {
      todoList: todoList,
      todos: sortTodos(todoList),
    });
  }
});

app.get("/lists/:todoListId/edit", (req, res, next) => {
  let todoListId = req.params.todoListId;
  let todoList = loadTodoList(+todoListId, req.session.todoLists);

  if (!todoList) {
    next(new Error("Not found."));
  } else {
    res.render("edit-list", {
      todoList: todoList,
    });
  }
});

app.post("/lists/:todoListId/destroy", (req, res, next) => {
  let todoListId = +req.params.todoListId;
  let todoLists = req.session.todoLists;
  let idx = todoLists.findIndex(list => list.id === todoListId);

  if (idx === -1) {
    next(new Error("Not found."));
  } else {
    todoLists.splice(idx, 1);
    req.flash("success", "Tod list deleted.");
    res.redirect("/lists");
  }
});

app.post("/lists/:todoListId/edit", 
  [
    body("todoListTitle")
      .trim()
      .isLength({ min: 1})
      .withMessage("The list title is required.")
      .isLength({ max: 100 })
      .withMessage("List title must be between 1 and 100 characters.")
      .custom((title, { req }) => {
        let todoLists = req.session.todoLists;
        return !todoLists.some(list => list.title === title);
      })
      .withMessage("List title must be unique."),
  ],
  (req, res, next) => {
  let todoListId = req.params.todoListId;
  let todoList = loadTodoList(+todoListId, req.session.todoLists);

  if (!todoList) {
    next(new Error("error", "Not found."));
  } else {
    let errors = validationResult(req);
    if (!errors.isEmpty()) {
      errors.array().forEach(error => req.flash("error", error.msg));

      res.render("edit-list", {
        flash: req.flash(),
        todoListTitle: req.body.todoListTitle,
        todoList: todoList,
      });
    } else {
      todoList.setTitle(req.body.todoListTitle);
      req.flash("success", "Todo list title changed.");
      res.redirect(`/lists/${todoListId}`);
    }
  }
});

// Toggle completion status of a todo
app.post("/lists/:todoListId/todos/:todoId/toggle", (req, res, next) => {
  let todoListId = req.params.todoListId;
  let todoId = req.params.todoId;
  let todo = loadTodo(+todoListId, +todoId, req.session.todoLists);

  if (!todo) {
    next(new Error("Not found."));
  } else {
    if (todo.isDone()) {
      todo.markUndone();
      req.flash("success", `${todo.title} marked as NOT done!`);
    } else {
      todo.markDone();
      req.flash("success", `${todo.title} marked as done!`);
    }

    res.redirect(`/lists/${todoListId}`);
  }
});

app.post("/lists/:todoListId/todos/:todoId/destroy", (req, res, next) => {
  let { todoListId, todoId } = { ...req.params };

  let todoList = loadTodoList(+todoListId, req.session.todoLists);
  if (!todoList) {
    next(new Error("Not found."));
  } else {
    let todo = loadTodo(+todoListId, +todoId, req.session.todoLists);
    if (!todo) {
      next(new Error("Not found."));
    } else {
      let idx = todoList.findIndexOf(todo);
      todoList.removeAt(idx);
      req.flash("success", "The todo has been deleted.");
      res.redirect(`/lists/${todoListId}`);
    }
  }
});

app.post("/lists/:todoListId/complete_all", (req, res, next) => {
  let todoListId = req.params.todoListId;
  let todoList = loadTodoList(+todoListId, req.session.todoLists);
  if (!todoList) {
    next(new Error("Not found."));
  } else {
    todoList.markAllDone();
    req.flash("success", "All todos are marked done.");
    res.redirect(`/lists/${todoListId}`);
  }
});

app.post("/lists/:todoListId/todos",
  [
    body("todoTitle")
      .trim()
      .isLength({ min: 1 })
      .withMessage("The todo title is required.")
      .isLength({ max: 100 })
      .withMessage("Todo title must be between 1 and 100 characters."),
  ],
  (req, res, next) => {
    let todoListId = req.params.todoListId;
    let todoList = loadTodoList(+todoListId, req.session.todoLists);
    if(!todoList) {
      next(new Error("Not found."));
    } else {
      let errors = validationResult(req);
      if (!errors.isEmpty()) {
        errors.array().forEach(message => req.flash("error", message.msg));

        res.render("list", {
          flash: req.flash(),
          todoList: todoList,
          todos: sortTodos(todoList),
          todoTitle: req.body.todoTitle,
        });
      } else {
        todoList.add(new Todo(req.body.todoTitle));
        req.flash("success", `${req.body.todoTitle} has been created.`);
        res.redirect(`/lists/${todoListId}`);
      }
    }
});

app.use((err, req, res, _next) => {
  console.log(err);
  res.status(404).send(err.message);
});

app.listen(port, host, () => {
  console.log(`Todos is listening on port ${port} of ${host}!`);
});