#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define MOVE_MAX 32

typedef struct Node {
    char move[MOVE_MAX];
    struct Node* next;
} Node;

static void push_back(Node** head, const char* mv) {
    Node* n = (Node*)malloc(sizeof(Node));
    strncpy(n->move, mv, MOVE_MAX - 1);
    n->move[MOVE_MAX - 1] = '\0';
    n->next = NULL;
    if (!*head) { *head = n; return; }
    Node* cur = *head;
    while (cur->next) cur = cur->next;
    cur->next = n;
}

static int pop_back(Node** head) {
    if (!*head) return 0;
    Node* cur = *head;
    if (!cur->next) { free(cur); *head = NULL; return 1; }
    while (cur->next && cur->next->next) cur = cur->next;
    free(cur->next);
    cur->next = NULL;
    return 1;
}

static void free_list(Node* head) {
    while (head) { Node* t = head->next; free(head); head = t; }
}

static void print_list(Node* head) {
    for (Node* cur = head; cur; cur = cur->next) {
        puts(cur->move);
    }
}

static void trim_newline(char* s) {
    size_t n = strlen(s);
    if (n && (s[n-1] == '\n' || s[n-1] == '\r')) s[n-1] = '\0';
}

static void load_moves(const char* path, Node** head) {
    FILE* f = fopen(path, "r");
    if (!f) return; // no file yet = empty list
    char buf[128];
    while (fgets(buf, sizeof(buf), f)) {
        trim_newline(buf);
        if (buf[0] == '\0') continue;
        push_back(head, buf);
    }
    fclose(f);
}

// In your C source file
int main(int argc, char** argv) {
    if (argc < 3) {
        fprintf(stderr, "usage: %s <add|undo|list|clear> <file> [move]\n", argv[0]);
        return 1;
    }

    const char* cmd = argv[1];
    const char* file = argv[2];

    Node* head = NULL;
    load_moves(file, &head);

    if (strcmp(cmd, "add") == 0) {
        if (argc < 4) { fprintf(stderr, "missing move for add\n"); free_list(head); return 2; }
        push_back(&head, argv[3]);
        print_list(head);
    } else if (strcmp(cmd, "undo") == 0) {
        // Find the last move before we remove it
        if (head) {
            Node* cur = head;
            if (!cur->next) {
                // ✅ If it's the only move, print it to stderr
                fprintf(stderr, "%s\n", cur->move);
            } else {
                while (cur->next && cur->next->next) cur = cur->next;
                // ✅ Print the last move to stderr
                fprintf(stderr, "%s\n", cur->next->move);
            }
        }
        pop_back(&head);
        print_list(head); // Print the new, shorter list to stdout
    } else if (strcmp(cmd, "list") == 0) {
        print_list(head);
    } else if (strcmp(cmd, "clear") == 0) {
        // print nothing
    } else {
        fprintf(stderr, "unknown command\n");
        free_list(head);
        return 3;
    }

    free_list(head);
    return 0;
}
