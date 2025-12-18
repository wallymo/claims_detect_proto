import { useState } from 'react'
import styles from './KnowledgeBasePanel.module.css'
import Icon from '@/components/atoms/Icon/Icon'
import Button from '@/components/atoms/Button/Button'

// Sample reference files from the MKG Knowledge Base
const SAMPLE_REFERENCES = [
  'Cho BC_N Engl J Med_2024.pdf',
  'Dalakas MC_Nat Rev Neurol_2020.pdf',
  'Dodick JAMA 2018 HALO-EM.pdf',
  'Hughes RAC_Cochrane Database Syst Rev_2014.pdf',
  'NCCN_CNS_v.2.2025.pdf',
  'Silberstein NEJM 2017.pdf',
  'van Doorn PA_Eur J Neurol_2023.pdf',
  // Add more as needed...
]

export default function KnowledgeBasePanel({ knowledgeBase, onKnowledgeBaseChange }) {
  // References folder is always expanded by default
  const [expandedFolders, setExpandedFolders] = useState({ References: true })
  const [showAddFolder, setShowAddFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')

  const toggleFolder = (folderName) => {
    setExpandedFolders(prev => ({
      ...prev,
      [folderName]: !prev[folderName]
    }))
  }

  const handleAddFolder = () => {
    if (!newFolderName.trim()) return

    onKnowledgeBaseChange(prev => ({
      ...prev,
      folders: [
        ...prev.folders,
        { name: newFolderName.trim(), expanded: false, files: [] }
      ]
    }))

    setNewFolderName('')
    setShowAddFolder(false)
  }

  // For demo, show the References folder with sample files
  const folders = [
    {
      name: 'References',
      files: SAMPLE_REFERENCES,
      count: 55 // Actual count from the knowledge base
    },
    ...knowledgeBase.folders.filter(f => f.name !== 'References')
  ]

  return (
    <div className={styles.knowledgeBase}>
      <div className={styles.folderList}>
        {folders.map(folder => (
          <div key={folder.name} className={styles.folder}>
            <button
              className={styles.folderHeader}
              onClick={() => toggleFolder(folder.name)}
            >
              <Icon
                name={expandedFolders[folder.name] ? 'chevronDown' : 'chevronRight'}
                size={14}
              />
              <Icon name="folder" size={16} />
              <span className={styles.folderName}>{folder.name}</span>
              <span className={styles.fileCount}>
                ({folder.count || folder.files?.length || 0})
              </span>
            </button>

            {expandedFolders[folder.name] && (
              <div className={styles.fileList}>
                {(folder.files || []).slice(0, 10).map((file, index) => (
                  <div key={index} className={styles.fileItem}>
                    <Icon name="fileText" size={14} />
                    <span className={styles.fileName}>{file}</span>
                  </div>
                ))}
                {folder.count > 10 && (
                  <div className={styles.moreFiles}>
                    +{folder.count - 10} more files...
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {showAddFolder ? (
        <div className={styles.addFolderForm}>
          <input
            type="text"
            placeholder="Folder name..."
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            className={styles.folderInput}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAddFolder()
              if (e.key === 'Escape') setShowAddFolder(false)
            }}
          />
          <div className={styles.addFolderActions}>
            <Button
              variant="ghost"
              size="small"
              onClick={() => setShowAddFolder(false)}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="small"
              onClick={handleAddFolder}
              disabled={!newFolderName.trim()}
            >
              Add
            </Button>
          </div>
        </div>
      ) : (
        <button
          className={styles.addFolderBtn}
          onClick={() => setShowAddFolder(true)}
        >
          <Icon name="plus" size={14} />
          Add Folder
        </button>
      )}
    </div>
  )
}
