const manifest = {
  editorOnly: true,
  name: 'To-Do',
  description: 'Record your project to-do!',
  tags: ['recommended'],
  credits: [
    {
      name: 'KOSHINO',
      link: 'https://github.com/KOSHINOawa'
    }
  ],
  enabledByDefault: true,
  userscripts: [
    {
      url: 'userscript.js'
    }
  ],
  userstyles: [
    {
      url: 'userstyle.css'
    }
  ]
};
export default manifest;
