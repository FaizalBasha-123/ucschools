# Super Admin API Routes

Base: `/api/v1/super-admin`

## School Management
- `GET /super-admin/schools` - List all schools
- `POST /super-admin/schools` - Create school
- `PUT /super-admin/schools/:id` - Update school
- `DELETE /super-admin/schools/:id` - Soft delete (trash)
- `POST /super-admin/schools/:id/restore` - Restore from trash

## Global Catalog
- `GET /super-admin/catalog/classes` - Global classes
- `POST /super-admin/catalog/classes` - Create class
- `PUT /super-admin/catalog/classes/:id` - Update class
- `DELETE /super-admin/catalog/classes/:id` - Delete class

- `GET /super-admin/catalog/subjects` - Global subjects
- `POST /super-admin/catalog/subjects` - Create subject
- `PUT /super-admin/catalog/subjects/:id` - Update subject
- `DELETE /super-admin/catalog/subjects/:id` - Delete subject

- `GET /super-admin/catalog/assignments` - Class-subject assignments
- `POST /super-admin/catalog/assignments` - Create assignment
- `DELETE /super-admin/catalog/assignments/:id` - Delete assignment

## Question Documents
- `GET /super-admin/question-documents` - List documents
- `GET /super-admin/question-documents/:id/view` - View
- `GET /super-admin/question-documents/:id/download` - Download
- `POST /super-admin/question-documents/upload` - Upload

## Study Materials
- `GET /super-admin/materials` - List materials
- `GET /super-admin/materials/:id/view` - View
- `GET /super-admin/materials/:id/download` - Download
- `POST /super-admin/materials/upload` - Upload
- `DELETE /super-admin/materials/:id` - Delete

## Blog Management
- `GET /super-admin/blogs` - List blog posts
- `POST /super-admin/blogs` - Create post
- `PUT /super-admin/blogs/:id` - Update post
- `DELETE /super-admin/blogs/:id` - Delete post

## Demo Requests
- `GET /super-admin/demo-requests` - List demo requests

## User Management
- `GET /super-admin/users` - List all platform users
- `POST /super-admin/users/:id/suspend` - Suspend user
- `DELETE /super-admin/users/:id` - Delete user
